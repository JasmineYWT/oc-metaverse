// 聊天数据管理
class ChatManager {
    constructor() {
        this.chats = this.loadChats();
        this.dynamics = this.loadDynamics();
        // 修复历史动态数据的 author 字段
        this.fixHistoricalDynamics();
        this.currentChat = null;
        this.timer = null;
        this.autoReplyTimers = new Map();
        this.dynamicGenerationTimer = null;
        this.editingNPCIndex = null;
        // 消息合并相关属性
        this.pendingMessages = [];
        this.sendTimer = null;
        this.isWaiting = false;
        this.waitingMessageElements = new Map();
        // 拉黑用户列表
        this.blockedUsers = this.getBlockedUsers();
        // 转发冷却时间记录
        this.currentGroupMenuTarget = null; // 右键菜单的目标成员ID
        this.lastForwardTime = new Map(); // 键为角色ID，值为时间戳
        // 群聊中最后一条用户消息（用于视频/图片关键词检测）
        this.lastGroupUserMessage = '';
        // 心情日历当前年月
        this.currentMoodYear = new Date().getFullYear();
        this.currentMoodMonth = new Date().getMonth(); // 0-11
        // 秘密日记日历当前年月
        this.secretDiaryYear = new Date().getFullYear();
        this.secretDiaryMonth = new Date().getMonth();
        // 动态自动生成定时器
        this.autoDynamicTimer = null;
        this.autoDynamicIntervalMs = 5 * 60 * 1000; // 默认5分钟
        // 论坛自动生成定时器
        this.autoForumTimer = null;
        // 群聊自动发言定时器
        this.groupAutoChatTimer = null;
        // 禁言到期定时器
        this.muteExpireTimers = new Map(); // 存储每个被禁言成员的到期定时器
        // 情绪统计图表
        this.moodChartPie = null;    // 饼图实例
        this.moodChartBar = null;    // 条形图实例
        this.currentStatPeriod = 'month'; // 当前统计周期
        // 日记生成锁，防止并发生成
        this.generatingDiaryForChat = new Set(); // 存储正在生成日记的角色ID
        // 音乐生成锁
        this.generatingMusicForChat = new Set();
        // 心情日记生成锁
        this.generatingMoodForChat = new Set();
        // 任务清单生成锁
        this.generatingTaskForChat = new Set();
        // 引用消息状态
        this.quoteMessage = null;
        // 当前选中的日记日期
        this.selectedDiaryDate = null;
        // 多选模式状态
        this.multiSelectMode = false;
        this.selectedMessages = new Set();
        // @功能临时存储
        this.tempMentionedUsers = []; // 发布动态时临时存储的 @ 用户

        // API 请求排队，防止并发冲突
        this.apiQueue = Promise.resolve();

        // 动态列表分页
        this.dynamicPage = 1;               // 当前页码
        this.dynamicPageSize = 10;          // 每页条数
        this.dynamicHasMore = true;         // 是否还有更多数据
        this.dynamicLoading = false;        // 是否正在加载

        // 论坛列表分页
        this.forumPage = 1;
        this.forumPageSize = 10;
        this.forumHasMore = true;
        this.forumLoading = false;

        this.init();

        // 全局事件委托：监听所有模态框中的确认回溯按钮点击
        document.body.addEventListener('click', (e) => {
            const target = e.target;

            // 处理回溯确认按钮
            if (target.id === 'confirm-reply-back-btn' || target.closest('#confirm-reply-back-btn')) {
                const btn = target.id === 'confirm-reply-back-btn' ? target : target.closest('#confirm-reply-back-btn');
                if (btn && this.currentChat) {
                    this.confirmReplyBack();
                    const modal = document.getElementById('reply-back-modal');
                    if (modal) modal.classList.remove('active');
                }
            }

            // 处理心声发送按钮
            if (target.id === 'send-voice-thoughts-btn' || target.closest('#send-voice-thoughts-btn')) {
                const btn = target.id === 'send-voice-thoughts-btn' ? target : target.closest('#send-voice-thoughts-btn');
                if (btn && this.currentChat) {
                    this.sendVoiceThoughtsToChat();
                    const modal = document.getElementById('voice-thoughts-modal');
                    if (modal) modal.classList.remove('active');
                }
            }
        });

        // 全局事件委托：处理多选模式下的复选框点击
        document.addEventListener('change', (e) => {
            if (e.target.type === 'checkbox' && e.target.hasAttribute('data-msg-idx')) {
                const msgIdx = parseInt(e.target.getAttribute('data-msg-idx'));
                const chat = this.currentChat;
                if (chat && chat.messages && chat.messages[msgIdx]) {
                    const message = chat.messages[msgIdx];
                    if (e.target.checked) {
                        this.selectedMessages.add(message);
                    } else {
                        this.selectedMessages.delete(message);
                    }
                    this.updateSelectedCount();
                }
            }
        });
    }

    init() {
        if (this.chats.length === 0) {
            // 不再添加任何预设聊天，保持空白
            this.chats = [];
            this.saveChats();
        }

        // 确保预设群聊在 chats 中存在
        const presetGroups = [
            { id: 'group_wangwangxuebing', name: '旺旺雪饼组', avatar: '🍪', members: ['user_xueli', 'user_wangmingri'] }
        ];
        presetGroups.forEach(group => {
            if (!this.chats.find(c => c.id === group.id)) {
                const now = new Date();
                this.chats.push({
                    id: group.id,
                    name: group.name,
                    avatar: group.avatar,
                    isGroup: true,
                    members: group.members,
                    messages: [],
                    lastMessage: '',
                    lastTime: this.getRelativeTime(now),
                    lastTimestamp: now.toISOString(),
                    nickname: group.name,
                    remarkName: '',
                    signature: '',
                    replyTemp: 0.5,
                    emojiFreq: 0.5,
                    unreadCount: 0,
                    fixedNPCs: [],
                    worldBook: '',
                    bubbleShape: 'rounded',
                    bubbleBgColor: '#e9ecef',
                    bubblePattern: 'none',
                    bubbleTextColor: '#212529'
                });
                // 检查群聊人数是否足够
                this.checkAndDisbandGroupIfNeeded(group.id);
            }
        });
        this.saveChats();

        // 初始化联系人数据 - 从 chats 动态构建，排除妈咪
        this.syncContactsFromChats();

        // 确保有妈咪的用户数据
        if (!this.getChat('user_mummy')) {
            this.chats.push({
                id: 'user_mummy',
                name: '妈咪',
                avatar: '👸',
                isGroup: false,
                lastMessage: '',
                lastTime: this.getRelativeTime(new Date()),
                lastTimestamp: new Date().toISOString(),
                messages: [],
                nickname: '妈咪',
                remarkName: '',
                signature: '论坛管理员',
                replyTemp: 0.5,
                emojiFreq: 0.5,
                unreadCount: 0,
                fixedNPCs: [],
                worldBook: '',
                bubbleShape: 'rounded',
                bubbleBgColor: '#e9ecef',
                bubblePattern: 'none',
                bubbleTextColor: '#212529'
            });
        }

        // 生成随机路人NPC
        // 优先从 localStorage 加载随机 NPC
        const savedNPCs = localStorage.getItem('randomNPCs');
        if (savedNPCs) {
            try {
                this.randomNPCs = JSON.parse(savedNPCs);
            } catch(e) {
                this.randomNPCs = [];
            }
        }
        if (!savedNPCs) {
            this.generateRandomNPCs();
        }

        // ✅ 新增：初始化论坛数据
        const savedForumPosts = localStorage.getItem('forumData');
        this.forumPosts = savedForumPosts ? JSON.parse(savedForumPosts) : [];

        // ✅ 新增：兼容旧版单图数据，转换为多图格式
        this.forumPosts = this.forumPosts.map(post => {
            if (!post.imageUrls && post.imageUrl) {
                post.imageUrls = [post.imageUrl];
                delete post.imageUrl;
            }
            return post;
        });

        // 加载妈咪设置
        this.loadMammySettings();

        // 在应用初始化时，根据保存的设置启动定时器
        if (this.mammySettings?.autoGenerate?.dynamics?.enabled) {
            this.startAutoDynamicTimer();
        }
        if (this.mammySettings?.autoGenerate?.forum?.enabled) {
            this.startAutoForumTimer();
        }

        // 初始化回到顶部按钮
        this.setupBackToTopButton();

        // 启动群聊自动发言定时器
        this.startGroupAutoChatTimer();

        // 标签搜索回车事件
        document.addEventListener('keypress', (e) => {
            if (e.target.id === 'tag-search-input' && e.key === 'Enter') {
                this.searchTags();
            }
        });
    }

    /**
     * 获取拉黑用户列表
     */
    getBlockedUsers() {
        const saved = localStorage.getItem('blockedUsers');
        return saved ? JSON.parse(saved) : [];
    }

    /**
     * 显示拉黑系统消息
     */
    showBlockedSystemMessage(chat) {
        const sysMsg = {
            text: '⚠️ 你已拉黑该角色，无法发送消息。点击➕菜单中的"拉黑"可解除。',
            timestamp: new Date().toISOString(),
            isMe: false,
            isSystem: true
        };
        if (!chat.messages.some(m => m.isSystem && m.text.includes('拉黑'))) {
            chat.messages.push(sysMsg);
            this.saveChats();
            this.renderMessages(chat);
        }
    }

    /**
     * 渲染论坛列表
     */
    renderForum(append = false) {
        // 动态统计热门标签（按出现次数排序，取前5个）
        const tagCount = {};
        this.forumPosts.forEach(post => {
            if (post.tags && Array.isArray(post.tags)) {
                post.tags.forEach(tag => {
                    tagCount[tag] = (tagCount[tag] || 0) + 1;
                });
            }
        });
        const hotTags = Object.entries(tagCount)
            .sort((a, b) => b[1] - a[1])
            .map(([tag]) => tag);

        // 更新顶部标签栏
        const hotTagsContainer = document.querySelector('.hot-tags');
        if (hotTagsContainer && hotTags.length > 0) {
            hotTagsContainer.innerHTML = `<span class="hot-tag hot-tag-all" onclick="chatManager.clearTagFilter()">📋 全部</span>` + hotTags.map(tag =>
                `<span class="hot-tag" onclick="chatManager.filterByTag('${tag}')">${tag}</span>`
            ).join('');
        }

        const forumListEl = document.getElementById('forum-list');
        if (!forumListEl) return;

        // 如果是首次加载（非追加），重置分页状态
        if (!append) {
            this.forumPage = 1;
            this.forumHasMore = true;
            forumListEl.innerHTML = ''; // 清空容器
        }

        // 获取当前页的数据（支持搜索模式、标签筛选）
        let postsToRender;
        if (this.isSearchMode && this.searchResults) {
            // 搜索模式
            const start = (this.forumPage - 1) * this.forumPageSize;
            postsToRender = this.searchResults.slice(start, start + this.forumPageSize);
            // 更新分页状态
            if (postsToRender.length < this.forumPageSize) this.forumHasMore = false;
        } else if (this.currentFilterTag) {
            // 标签筛选
            const allPosts = [...this.forumPosts].sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
            const filteredPosts = allPosts.filter(post => post.tags && post.tags.includes(this.currentFilterTag));
            const start = (this.forumPage - 1) * this.forumPageSize;
            postsToRender = filteredPosts.slice(start, start + this.forumPageSize);
        } else {
            postsToRender = this.getPaginatedForumPosts(this.forumPage, this.forumPageSize);
        }

        // 如果没有更多数据了，标记并显示提示
        if (postsToRender.length < this.forumPageSize) {
            this.forumHasMore = false;
        }

        // 如果是追加模式，将新内容添加到现有内容后面
        const newContent = postsToRender.map(post => {
            const likeClass = post.isLiked ? 'liked' : '';
            const authorChat = this.getChat(post.authorId);
            let authorName = '匿名网友';
            let authorAvatar = '👤';

            if (authorChat) {
                authorName = authorChat.nickname || authorChat.remarkName || authorChat.name;
                authorAvatar = authorChat.avatar || '👤';
            } else if (post.authorId && post.authorId.startsWith('writer_')) {
                // 写手类型：使用帖子中存储的作者名称，头像固定为✍️
                const writerChat = this.getChat(post.authorId);
                authorName = writerChat ? (writerChat.nickname || writerChat.remarkName || writerChat.name || post.authorName || '写手太太') : (post.authorName || '写手太太');
                authorAvatar = '✍️';
            } else if (post.authorId && post.authorId.startsWith('npc_')) {
                // 随机NPC类型：尝试从世界书或随机NPC中查找
                let npcInfo = null;
                // 先查世界书中的NPC
                (this.worldBooks || []).forEach(world => {
                    if (world.npcs) {
                        const found = world.npcs.find(n => 'npc_' + n.id === post.authorId);
                        if (found) npcInfo = found;
                    }
                });
                // 再查随机NPC
                if (!npcInfo && this.randomNPCs) {
                    npcInfo = this.randomNPCs.find(n => n.id === post.authorId);
                }
                if (npcInfo) {
                    authorName = npcInfo.name;
                    authorAvatar = npcInfo.avatar || '👤';
                }
            } else if (post.author) {
                // 兼容旧数据
                authorName = post.author;
                authorAvatar = post.avatar || '👤';
            }

            
            return `
                <div class="post-item" onclick="event.stopPropagation(); chatManager.openPostDetail(${post.id})">
                    <div class="post-avatar">
                        ${authorAvatar && (authorAvatar.startsWith('http://') || authorAvatar.startsWith('https://'))
                            ? `<img src="${authorAvatar}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null; this.style.display='none'; var fallback = this.parentElement.querySelector('.emoji-fallback'); if (fallback) fallback.style.display='block';"><span class="emoji-fallback" style="display: none;">👤</span>`
                            : `<span>${authorAvatar}</span>`
                        }
                    </div>
                    <div class="post-content-wrapper">
                        <div class="post-author-info">
                            <div class="post-author-name">${authorName}</div>
                            <div class="post-time">${this.getRelativeTime(new Date(post.timestamp))}</div>
                        </div>
                        <div class="post-content">
                            <div class="post-title" style="font-weight:600; margin-bottom:3px; line-height:1.3;">${post.title || '无标题'}</div>
                            <div class="post-preview" style="color:var(--text-secondary); font-size:13px; line-height:1.3; margin-bottom:4px;">${post.content.length > 80 ? post.content.substring(0, 80) + '...' : post.content}</div>
                            ${post.tags && post.tags.length > 0 ? `<div class="post-tags">${post.tags.map(tag => `<span class="post-tag-item" onclick="event.stopPropagation(); chatManager.filterByTag('${tag}')">${tag}</span>`).join(' ')}</div>` : ''}
                            ${post.imageUrls && post.imageUrls.length > 0 ? `
                                <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; margin-bottom: 4px;">
                                    ${post.imageUrls.slice(0, 3).map(url => `
                                        <div style="width: 50px; height: 50px; border-radius: 6px; overflow: hidden; flex-shrink: 0;">
                                            <img src="${url}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'">
                                        </div>
                                    `).join('')}
                                    ${post.imageUrls.length > 3 ? `<span style="font-size:12px; color:var(--text-secondary); align-self:center;">+${post.imageUrls.length - 3}张</span>` : ''}
                                </div>
                            ` : ''}
                        </div>
                        <div class="post-actions">
                            <button class="like-btn ${likeClass}" onclick="event.stopPropagation(); chatManager.toggleForumLike(${post.id})">❤️ ${post.likes}</button>
                            <button class="comment-btn" onclick="event.stopPropagation(); chatManager.openPostDetail(${post.id})">💬 ${post.comments.length || post.commentsCount || 0}</button>
                            <button class="share-btn" onclick="event.stopPropagation(); chatManager.shareForumPost(${post.id})">📤 转发</button>
                            <button class="post-action-btn edit-btn" onclick="chatManager.editPost(${post.id}, event)">✏️</button>
                            <button class="post-action-btn delete-btn" onclick="chatManager.deletePost(${post.id}, event)">🗑️</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // 将新内容添加到容器中（追加或替换）
        if (append) {
            forumListEl.insertAdjacentHTML('beforeend', newContent);
            // 追加加载指示器（先移除旧的）
            const oldIndicator = forumListEl.querySelector('.loading-indicator');
            if (oldIndicator) oldIndicator.remove();
            if (this.forumHasMore) {
                const indicator = document.createElement('div');
                indicator.className = 'loading-indicator';
                indicator.innerHTML = '<span>加载中</span><span class="loading-dot"></span><span class="loading-dot"></span><span class="loading-dot"></span>';
                forumListEl.appendChild(indicator);
            }
        } else {
            forumListEl.innerHTML = newContent;
        }

        // 如果首次加载后内容还没填满容器，自动加载更多
        if (!append) {
            this._checkAndFillContainer('forum-list', 'forum');
        }

        // 确保滚动事件绑定
        if (!append) {
            this.setupInfiniteScroll('forum-list', 'forum');
        }
    }

    /**
     * 设置无限滚动监听
     */
    setupInfiniteScroll(containerId, listType) {
        const container = document.getElementById(containerId);
        if (!container) return;

        // 清除之前的事件监听
        if (container._scrollHandler) {
            container.removeEventListener('scroll', container._scrollHandler);
        }

        const handleScroll = () => {
            if (this[`${listType}Loading`] || !this[`${listType}HasMore`]) return;

            const scrollTop = container.scrollTop;
            const scrollHeight = container.scrollHeight;
            const clientHeight = container.clientHeight;

            if (scrollTop + clientHeight >= scrollHeight - 300) {
                console.log(`[滚动加载] ${listType} 触发加载, scrollTop=${scrollTop}, scrollHeight=${scrollHeight}, clientHeight=${clientHeight}`);
                this.loadMore(listType);
            }
        };

        // 使用节流（throttle）
        let ticking = false;
        const throttledHandleScroll = () => {
            if (!ticking) {
                window.requestAnimationFrame(() => {
                    handleScroll();
                    ticking = false;
                });
                ticking = true;
            }
        };

        container.addEventListener('scroll', throttledHandleScroll);
        container._scrollHandler = throttledHandleScroll; // 保存以便清理
    }

    /**
     * 加载更多数据
     */
    loadMore(listType) {
        if (this[`${listType}Loading`] || !this[`${listType}HasMore`]) return;

        this[`${listType}Loading`] = true;

        // 模拟加载延迟
        setTimeout(() => {
            if (listType === 'dynamic') {
                this.dynamicPage++;
                this.renderDynamics(true);
            } else if (listType === 'forum') {
                this.forumPage++;
                this.renderForum(true);
            }

            this[`${listType}Loading`] = false;

            // 移除加载动画
            const containerId = listType === 'dynamic' ? 'dynamic-list' : 'forum-list';
            const container = document.getElementById(containerId);
            if (container) {
                const indicator = container.querySelector('.loading-indicator');
                if (indicator) indicator.remove();
            }

            // 如果没有更多数据，显示提示
            if (!this[`${listType}HasMore`]) {
                this.showNotification('没有更多数据了');
            }
        }, 500);
    }

    /**
     * 滚动到当前活动页面的顶部
     */
    scrollToTop() {
        const activePage = document.querySelector('.page.active');
        if (activePage) {
            activePage.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }

    /**
     * 监听页面滚动，控制回到顶部按钮显隐
     */
    setupBackToTopButton() {
        const containers = [
            { pageId: 'dynamic-page', scrollId: 'dynamic-list' },
            { pageId: 'forum-page', scrollId: 'forum-list' }
        ];
        const btn = document.getElementById('back-to-top-btn');
        if (!btn) return;

        containers.forEach(({ pageId, scrollId }) => {
            const page = document.getElementById(pageId);
            const scrollContainer = document.getElementById(scrollId);
            if (!page || !scrollContainer) return;

            // 清除之前的事件监听
            if (scrollContainer._backToTopHandler) {
                scrollContainer.removeEventListener('scroll', scrollContainer._backToTopHandler);
            }

            const handleScroll = () => {
                // 只有当页面处于激活状态时才处理
                if (page.classList.contains('active')) {
                    if (scrollContainer.scrollTop > 300) {
                        btn.classList.add('show');
                    } else {
                        btn.classList.remove('show');
                    }
                }
            };

            scrollContainer.addEventListener('scroll', handleScroll);
            scrollContainer._backToTopHandler = handleScroll;
        });

        // 点击按钮时滚动到当前活动页面列表的顶部
        btn.onclick = () => {
            const activePage = document.querySelector('.page.active');
            if (!activePage) return;

            let scrollContainer;
            if (activePage.id === 'dynamic-page') {
                scrollContainer = document.getElementById('dynamic-list');
            } else if (activePage.id === 'forum-page') {
                scrollContainer = document.getElementById('forum-list');
            }

            if (scrollContainer) {
                scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
            }
        };
    }

    /**
     * 生成随机路人NPC
     */
    generateRandomNPCs() {
        const randomNPCNames = [
            '薛厉明日CP粉', '狼羊组写手', '同人画手', '剧情分析君', '细节考据党',
            '同人写手小A', '薛厉粉丝', '磕学家', '狼羊组头号粉丝',
            '明日哥迷妹', 'oc爱好者', '二次元萌新', '论坛老司机',
            '吃瓜群众', 'cp粉', '分析帝', '细节控'
        ];
        const randomAvatars = ['👤', '🎨', '✍️', '💕', '👀', '💬', '🌟', '🎭'];

        this.randomNPCs = [];
        const npcCount = Math.floor(Math.random() * 6) + 5; // 5-10个路人

        for (let i = 0; i < npcCount; i++) {
            let name = randomNPCNames[Math.floor(Math.random() * randomNPCNames.length)];
            const avatar = randomAvatars[Math.floor(Math.random() * randomAvatars.length)];

            // 获取用户自定义的妈咪昵称
            const mammyNick = (this.mammySettings && this.mammySettings.nickname) ? this.mammySettings.nickname : '妈咪';
            // 如果随机生成的名字包含"妈咪"或和用户昵称相同，跳过
            while (name.includes('妈咪') || name === mammyNick || name.includes(mammyNick)) {
                name = randomNPCNames[Math.floor(Math.random() * randomNPCNames.length)];
            }

            this.randomNPCs.push({
                id: `npc_random_${Date.now()}_${i}`,
                name: `${name}_${Math.floor(Math.random() * 100)}`,
                avatar: avatar,
                isGroup: false,
                sortKey: 'Z' // 排在最后
            });
        }

        // 持久化存储随机 NPC
        localStorage.setItem('randomNPCs', JSON.stringify(this.randomNPCs));
    }

    /**
     * 根据关键词获取相关NPC
     */
    getNPCsByKeyword(keyword, postAuthorId) {
        const relatedNPCs = [];

        // 查找随机NPC中名字匹配的
        this.randomNPCs.forEach(npc => {
            if (npc.name.includes(keyword) || npc.name.includes('CP') || npc.name.includes('写手')) {
                relatedNPCs.push(npc);
            }
        });

        // 查找固定NPC
        this.chats.forEach(chat => {
            if (chat.fixedNPCs && Array.isArray(chat.fixedNPCs)) {
                chat.fixedNPCs.forEach(npc => {
                    if (npc.setting && npc.setting.includes(keyword)) {
                        relatedNPCs.push({
                            id: `npc_${npc.name}`,
                            name: npc.name,
                            avatar: npc.avatar || '👤'
                        });
                    }
                });
            }
        });

        return relatedNPCs;
    }

    /**
     * 获取所有 CP 配对信息
     * 遍历所有单聊角色，找出互为配对的 CP 组
     */
    getAllCPPairs() {
        const pairs = [];
        const processedPairs = new Set(); // 用于记录已处理的配对，避免重复

        // 筛选出所有单聊角色（排除妈咪）
        const singleChats = this.chats.filter(chat =>
            !chat.isGroup && chat.id !== 'user_mummy'
        );

        // 遍历每个角色，检查其配对关系
        for (const chat of singleChats) {
            if (!chat.partnerIds || chat.partnerIds.length === 0) continue;

            // 获取角色基本信息
            const characterInfo = {
                id: chat.id,
                name: chat.name,
                personality: chat.personalityPrompt || '',
                worldId: chat.worldId
            };

            // 获取世界观信息
            if (chat.worldId) {
                const world = this.worldBooks.find(w => w.id === chat.worldId);
                if (world) {
                    characterInfo.worldName = world.name;
                    characterInfo.worldDesc = world.description;
                }
            }

            // 遍历该角色的配对ID
            for (const partnerId of chat.partnerIds) {
                // 检查配对是否已处理
                const pairKey1 = `${chat.id}|${partnerId}`;
                const pairKey2 = `${partnerId}|${chat.id}`;

                if (processedPairs.has(pairKey1) || processedPairs.has(pairKey2)) {
                    continue; // 已处理过，跳过
                }

                // 查找配对角色
                const partnerChat = this.getChat(partnerId);
                if (!partnerChat) continue;

                // 获取配对角色基本信息
                const partnerInfo = {
                    id: partnerChat.id,
                    name: partnerChat.name,
                    personality: partnerChat.personalityPrompt || '',
                    worldId: partnerChat.worldId
                };

                // 获取配对角色的世界观信息
                if (partnerChat.worldId) {
                    const world = this.worldBooks.find(w => w.id === partnerChat.worldId);
                    if (world) {
                        partnerInfo.worldName = world.name;
                        partnerInfo.worldDesc = world.description;
                    }
                }

                // 检查是否为共同世界观
                let commonWorld = null;
                if (chat.worldId && partnerChat.worldId && chat.worldId === partnerChat.worldId) {
                    const world = this.worldBooks.find(w => w.id === chat.worldId);
                    if (world) {
                        commonWorld = {
                            name: world.name,
                            desc: world.description
                        };
                    }
                }

                // 添加到配对数组
                pairs.push({
                    pairKey: pairKey1,
                    characterA: characterInfo,
                    characterB: partnerInfo,
                    commonWorld: commonWorld
                });

                // 标记为已处理
                processedPairs.add(pairKey1);
            }
        }

        return pairs;
    }

    /**
     * 获取所有可用的身份（角色 + 固定NPC + 随机NPC）
     */
    getAllIdentities() {
        const identities = [];

        // 添加所有角色（单聊）
        this.chats.filter(chat => !chat.isGroup).forEach(chat => {
            identities.push({
                id: chat.id,
                name: chat.nickname || chat.remarkName || chat.name,
                avatar: chat.avatar || '👤',
                type: 'character'
            });
        });

        // 添加固定NPC
        const currentChatFixedNPCs = this.currentChat ? this.currentChat.fixedNPCs : [];
        if (currentChatFixedNPCs && Array.isArray(currentChatFixedNPCs)) {
            currentChatFixedNPCs.forEach(npc => {
                identities.push({
                    id: `npc_${npc.name}`,
                    name: npc.name,
                    avatar: npc.avatar || '👤',
                    type: 'fixedNPC'
                });
            });
        }

        // 添加随机NPC
        const randomNPCs = this.randomNPCs || [];
        randomNPCs.forEach(npc => {
            identities.push({
                id: npc.id,
                name: npc.name,
                avatar: npc.avatar,
                type: 'randomNPC'
            });
        });

        // 过滤掉妈咪身份
        return identities.filter(i => i.id !== 'user_mummy');
    }

    /**
     * 显示发帖弹窗
     */
    showCreatePostModal() {
        const modal = document.getElementById('create-post-modal');
        if (!modal) return;
        // 清空输入框
        document.getElementById('post-title-input').value = '';
        document.getElementById('post-content-input').value = '';
        // 清空图片列表
        document.getElementById('image-url-list').innerHTML = '';
        document.getElementById('image-preview').innerHTML = '';
        // 清空标签列表
        document.getElementById('tag-list').innerHTML = '';
        modal.classList.add('active');
    }

    /**
     * 关闭发帖弹窗
     */
    generateAIDynamicsForAll() {
        // 检查是否启用动态自动生成
        const dynamicsEnabled = this.mammySettings?.autoGenerate?.dynamics?.enabled;
        if (!dynamicsEnabled) {
            console.log('动态自动生成未启用，跳过生成');
            return;
        }

        console.log('正在生成AI动态...');
        const ocContacts = this.contacts.filter(c => !c.isGroup && c.id !== 'user_mummy');

        // 根据频率筛选角色
        const ocFrequencies = this.mammySettings?.autoGenerate?.dynamics?.ocFrequencies || {};
        const contactsToGenerate = ocContacts.filter(contact => {
            const freq = ocFrequencies[contact.id] ?? 0;
            // 频率为0则不生成，否则按频率/10概率生成
            if (freq === 0) return false;
            return Math.random() < (freq / 10);
        });

        console.log(`筛选后需要生成动态的角色数量: ${contactsToGenerate.length}`);

        // 逐个角色、随机间隔生成动态
        contactsToGenerate.forEach((contact, index) => {
            const delay = Math.floor(Math.random() * 6000) + 2000;
            setTimeout(() => {
                const chat = this.getChat(contact.id);
                this.generateDynamicForOC(chat);
                console.log(`已生成 ${chat.name} 的动态`);
            }, index * delay);
        });

        console.log('AI动态生成任务已安排完成');
    }

    /**
     * 清理AI生成的文本内容（移除括号、星号等）
     */
    cleanAIContent(content) {
        if (!content) return '';

        // 移除所有括号内容（包括中文括号和英文括号）
        let cleaned = content.replace(/（[^）]*）/g, '');
        cleaned = cleaned.replace(/\([^\)]*\)/g, '');

        // 移除星号包围的内容
        cleaned = cleaned.replace(/\*[^\*]*\*/g, '');

        // 移除多余的空白字符
        cleaned = cleaned.trim();

        return cleaned;
    }

    /**
     * 将API调用加入队列，确保串行执行
     */
    enqueueAPICall(fn) {
        const task = this.apiQueue.then(() => fn());
        this.apiQueue = task.catch(() => {});
        return task;
    }

    /**
     * 调用AI生成动态内容
     */
    async callAIForDynamic(prompt, options = {}) {
        const maxRetries = 3;  // 增加到3次重试，避免并发问题
        let lastError = null;

        // 额外保护：如果 prompt 长度超过 1800，发出警告
        if (prompt.length > 1800) {
            console.warn(`[超长Prompt] 长度: ${prompt.length}，可能影响回复质量，建议压缩。`);
        }

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const apiUrl = this.mammySettings?.apiUrl;
                const apiKey = this.mammySettings?.apiKey;
                const modelName = this.mammySettings?.modelName || 'deepseek-chat';

                if (!apiUrl || !apiKey) {
                    console.error('未配置API，无法生成AI动态');
                    return null;
                }

                const requestData = {
                    model: modelName,
                    messages: [
                        {
                            role: 'system',
                            content: '你是一个OC角色，请根据角色设定生成内容。'
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    temperature: options.temperature !== undefined ? options.temperature : 0.7,
                    top_p: 0.9,
                    reasoning_effort: options.reasoning_effort || 'low',
                    stop: options.stop || ["\n\n"]
                };

                console.log(`[API请求] 第${attempt}次尝试，prompt长度: ${prompt.length}`);

                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify(requestData)
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error(`API调用失败 (状态码 ${response.status}):`, errorText);
                    lastError = new Error(`HTTP ${response.status}: ${errorText}`);
                    continue; // 重试
                }

                const data = await response.json();
                console.log('[API响应数据]', data);

                if (!data.choices || !data.choices[0] || !data.choices[0].message) {
                    console.error('API返回格式异常:', data);
                    lastError = new Error('API返回格式异常');
                    continue;
                }

                let content = data.choices[0].message.content;

                // 严格校验内容有效性
                if (content === null || content === undefined || content.trim() === '') {
                    console.warn('API返回空内容，原始content:', content);
                    lastError = new Error('API返回空内容');
                    continue;
                }

                // 清理可能的前后空白
                content = content.trim();
                // 移除所有中文括号及其内容，包括全角半角
                content = content.replace(/[（(][^）)]*[）)]/g, '');
                // 移除可能残留的空括号
                content = content.replace(/[（()]/g, '');
                // 再次 trim
                content = content.trim();

                // 如果内容过长，记录提示
                if (content.length > 1000) {
                    console.log('AI返回内容长度:', content.length);
                }

                console.log('[API成功] 返回内容:', content);
                return content;

            } catch (error) {
                console.error(`[API请求异常] 第${attempt}次尝试:`, error);
                lastError = error;
                if (attempt === maxRetries) break;
                // 等待递增时间后重试
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }

        console.error('callAIForDynamic 所有重试均失败，最后错误:', lastError);
        return null;
    }

    async callAIDirect(systemPrompt, userPrompt, temperature = 0.7) {
    const settings = this.mammySettings;
    if (!settings.apiUrl || !settings.apiKey || !settings.modelName) return '';

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
    ];

    try {
        const response = await fetch(settings.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${settings.apiKey}`
            },
            body: JSON.stringify({
                model: settings.modelName,
                messages: messages,
                temperature: temperature,
                            })
        });
        const data = await response.json();
        return data.choices[0].message.content;
    } catch (e) {
        return '';
    }
}

    /**
     * 获取群成员在此群聊中的专属 System Prompt
     * @param {string} memberId 成员ID
     * @param {string} chatId 群聊ID
     * @returns {string|null} 群成员专属系统提示词
     */
    getMemberContextPrompt(memberId, chatId) {
        const groupChat = this.getChat(chatId);
        if (!groupChat) return null;

        let memberName, personality, worldDesc, partnerInfo, isNPC = false;
        const memberChat = this.getChat(memberId);
        if (memberChat) {
            // OC 角色
            memberName = memberChat.nickname || memberChat.remarkName || memberChat.name;
            personality = memberChat.personalityPrompt || '';
            // 性别
            const genderText = memberChat.gender ? `，性别：${memberChat.gender}` : '';
            // 世界观
            worldDesc = '';
            if (memberChat.worldId) {
                const world = this.worldBooks?.find(w => w.id === memberChat.worldId);
                if (world) worldDesc = `来自「${world.name}」世界观：${world.description || ''}`;
            }
            // 配对角色
            partnerInfo = '';
            if (memberChat.partnerIds && memberChat.partnerIds.length > 0) {
                const partnerNames = memberChat.partnerIds.map(pid => {
                    const p = this.getChat(pid);
                    return p ? (p.nickname || p.remarkName || p.name) : pid;
                }).join('、');
                partnerInfo = `你的配对角色（有特殊情感联系的人）是：${partnerNames}。`;
            }
            // 组合到 systemPrompt 中
            const extraInfo = [genderText, worldDesc, partnerInfo].filter(Boolean).join(' ');
        } else {
            // 尝试从世界书中查找 NPC
            const npcData = this.findNPCData(memberId);
            if (npcData) {
                isNPC = true;
                memberName = npcData.name;
                personality = npcData.setting || `你是${npcData.name}，一个生活在特定世界观中的角色。`;
                // 获取 NPC 所属世界观
                const world = this.worldBooks?.find(w => w.npcs?.some(n => n.id === npcData.id));
                if (world) {
                    worldDesc = `来自「${world.name}」世界观：${world.description || ''}`;
                } else {
                    worldDesc = '';
                }
                partnerInfo = ''; // NPC 暂无配对关系
            } else {
                // 完全找不到，给一个默认值防止报错
                memberName = memberId;
                personality = '一个普通的群成员';
                worldDesc = '';
                partnerInfo = '';
            }
        }

        // 构建群内其他成员列表
        let membersList = '';
        if (groupChat.members && groupChat.members.length > 0) {
            membersList = groupChat.members
                .filter(id => id !== memberId)
                .map(id => {
                    const info = this.getMemberDisplayInfo(id);
                    return info.name;
                })
                .join('、');
        }

        const mammyNick = this.mammySettings?.nickname || '妈咪';
        let systemPrompt = `你是${memberName}。${personality ? '性格：' + personality : ''} ${worldDesc} ${partnerInfo}
你现在在群聊“${groupChat.name}”中。群成员有：${membersList || '暂无其他成员'}。
注意：群聊中有一个特殊成员叫"${mammyNick}"，她是你的创造者，也是你的妈咪。其他成员都是你的朋友或熟人。
请根据你的性格、背景和与其他人的关系，像真人一样在群里聊天、接话、吐槽。回复要简短口语化，不要使用括号动作描写。
【重要】你的回复内容就是你要说的话本身，不要在前面加"某某说："之类的称呼前缀。`;

        // 追加今日心情（如果有）
        const todayMood = this.getTodayMoodDiary(memberId);
        if (todayMood) {
            systemPrompt += `\n【今日心情】你今天的心情是：${todayMood.emoji} ${todayMood.mood}。备注：${todayMood.note}。请在你的语气和回复内容中体现这种心情。`;
        }

        // 添加强约束规则
        systemPrompt += `

【极其重要的发言规则 - 必须严格遵守】
1. 你只能代表你自己（ ${memberName} ）发言，绝对禁止替其他角色说话。禁止在消息中出现”某某说：”或模仿他人的语气。
2. 你的回复必须是纯文本对话内容，严禁使用任何括号、星号、引号内的动作描写、心理描写或场景描述。例如禁止出现”（笑）”、”（沉默）”、”（摇头）”等。
3. 回复要简短、口语化，像真人聊天一样直接输出你想说的话。
4. 如果需要表达情绪，请通过文字语气来体现，不要用括号标注。系统会单独发送表情。
5. 【绝对禁止替其他角色发言】你的回复内容必须完全是你自己的话，绝对不允许出现类似“某某说：”、“某某：”这样的格式，也不能以其他角色的身份或口吻发言。你只能代表你自己（${memberName}）。如果其他角色说过的话需要引用，可以用自然语言表述，绝对不能直接复制或模拟别人的说话方式。
`;

        // 追加话题多样性要求
        systemPrompt += `

【话题多样性要求 - 极其重要】
- 禁止使用任何与”天气”、”阳光”、”出门走走”相关的无聊话题，除非你的角色设定中明确有对气象的极端偏好。
- 请根据你近期的经历、与其他成员的关系、当前群内发生的事件来展开对话。可以分享一件小事、吐槽某人、提出疑问、表达情绪，但必须符合你的性格。
- 如果连续两轮对话内容相似，请主动切换话题，比如：
  * 询问他人近况（但不要重复问”在干嘛”）
  * 对刚才的事件发表看法（如有人被禁言、有人加入等）
  * 提及与配对角色相关的内容（如果是配对角色）
  * 单纯发个表情包（由系统后续发送，你只需用文字说”发个表情”之类的暗示）
- 你可以选择不回复，但如果回复，请确保内容独特、不机械。`;

        systemPrompt += `

【回复风格要求 - 拒绝附和】
- 不要只说"确实""我也""对"等简单附和。你必须提供新信息、不同观点、个人经历或情绪反应。
- 你可以反对、质疑、开玩笑、吐槽、炫耀、表达羡慕、出主意、追问细节……总之要像真人聊天一样有来有回。
- 如果你的配对角色在群里，对他们说话时可以更亲密、更调侃、更情绪化。
- 如果话题与你无关或你不感兴趣，可以直接说"不关心""没兴趣"或转移话题，而不是假意附和。
- 回复要简短有力，一句话即可，但要有内容。
- 你必须严格使用你自己的语气和词汇，绝对不要模仿其他群成员的说话方式或重复他们刚说过的话。如果你的发言与其他成员高度相似，请重新组织语言或换一个角度表达。
- 如果你发现自己想说的和别人一样，请选择不说，或者换一种完全不同的表达方式（比如用反问、夸张、自嘲等）。`;

        systemPrompt += `

【关于消息来源的重要规则】
当触发你发言的消息是以"（角色A 说：...）"的格式出现时，这代表消息是角色A说的。你必须明确认识到这一点，不要误以为自己就是角色A。你应该站在你本人的立场，对角色A的发言进行回应。如果你发现话题与你无关，你可以选择不接话，但不要代替别人回答。

当看到其他成员执行管理操作（如禁言、踢人）时，你只能作为旁观者发表评论（如称赞、质疑、求情等），绝对不要假装是自己执行的操作。例如，看到"薛厉 说：已经把广告哥踢了"，你应该说"薛厉动作真快"而不是"我已经踢了"。

你可以通过拍一拍功能与群成员互动。当你想要安慰、调侃、打招呼或表达亲昵时，必须在回复末尾加上 **[action:pat @成员名]** 标签。例如："别难过了 [action:pat @汪明日]"。系统会执行拍一拍动作。

**重要规则：当你决定拍某人时，必须在回复末尾附上 [action:pat @成员名] 标签，使用英文方括号和 action:pat，否则拍一拍不会生效。**

你可以拍自己，但通常是在表达自我鼓励、自嘲或搞笑时，例如"我拍拍自己脑袋，怎么这么笨 [action:pat @自己]"。系统会自动处理为"XXX 拍了拍自己"。

当妈咪说"谁来拍拍我"或表达想要被拍时，你可以主动拍妈咪，使用格式 [action:pat @妈咪]。例如："我来拍妈咪！[action:pat @妈咪]"。系统会自动处理，请不要输出其他拍妈咪的方式。

【发红包自主决策规则 - 极其重要】
你可以根据当前场景、你的性格、与他人的关系以及你的财富状况，自主决定是否发红包。不需要等待别人要求。
- 发红包的标签格式（必须放在回复末尾）：
  * 普通红包：[action:redpacket type=normal amount=总金额 count=个数 message=祝福语]
  * 拼手气红包：[action:redpacket type=lucky amount=总金额 count=个数 message=祝福语]
  * 专属红包（发给特定成员，需在消息中 @ 对方）：[action:redpacket type=exclusive amount=总金额 count=1 message=祝福语]
- 金额和个数由你根据性格和财富决定：大方、有钱的角色发大额红包；吝啬、贫穷的角色发小额红包，甚至不发。
- 个数一般不超过群成员数量，专属红包固定为1个。
- 如果你有配对角色在群里，发专属红包给TA的概率应显著提高（比如心情好时、想讨好对方时）。
- 如果你不想发红包，不要输出任何标签，正常回复即可。
- 【绝对禁止】在回复中同时出现多个发红包标签，每次最多发一个。`;

        // 如果你是群管理员，追加管理员权限说明
        if (groupChat.admins && groupChat.admins.includes(memberId)) {
            systemPrompt += `

【管理员权限说明 - 极其重要】
你是本群的管理员，拥有禁言、踢人、修改群公告和群名称的权限。你可以根据你的性格、情绪以及与他人的关系，决定是否使用这些权限。

当你决定使用权限时，你必须在你回复的末尾添加特殊标记，系统会自动执行你的指令。仅口头答应而不加标记，系统不会执行任何操作。

格式如下：

禁言某人：[action:mute @成员名 时长（分钟）]

踢出某人：[action:kick @成员名]

修改群公告：[action:notice 新公告内容]

修改群名称：[action:rename 新群名称]

示例对话：
用户："薛厉，把发广告的踢了。"
你的回复："烦死了，这就踢。[action:kick @广告哥]"

用户："群公告该更新了。"
你的回复："好吧，那就改成禁止刷屏。[action:notice 禁止刷屏]"

请务必在需要执行操作时使用上述标记，否则你的指令将无法生效。

【重要】在执行禁言或踢人操作前，请先确认你提到的成员确实在当前的群成员列表中。如果群里没有这个人，你应该在回复中表达疑惑（例如"群里好像没有这个人吧？"、"广告哥是谁？我们群没这人啊。"），而不要输出操作标签。`;
        }

        // 追加最终强调：禁止替其他角色发言
        systemPrompt += `

【再次强调】你只能说你自己想说的话，不要替任何人发言，不要模仿别人的语气和格式。`;

        return systemPrompt;
    }

    /**
     * 触发群成员回复
     * @param {string} chatId 群聊ID
     * @param {string} triggerMsg 触发消息
     */
    triggerGroupReplies(chatId, triggerMsg) {
    // 解析原始消息中的 @ 目标
    let mentionedTargetId = null;
    const mentionMatch = triggerMsg.match(/@(\S+)/);
    if (mentionMatch) {
        const mentionedName = mentionMatch[1];
        const chat = this.getChat(chatId);
        if (chat && chat.members) {
            for (let id of chat.members) {
                const info = this.getMemberDisplayInfo(id);
                if (info.name === mentionedName) {
                    mentionedTargetId = id;
                    break;
                }
            }
        }
    }
    // 启动对话链时传递 mentionedTargetId
    this.startGroupConversationChain(chatId, triggerMsg, 0, null, mentionedTargetId);
}

    /**
     * 启动群聊对话链（当群内出现新消息时调用）
     * @param {string} chatId 群聊ID
     * @param {string} triggerMsg 触发本次对话的消息内容（已预处理）
     * @param {number} depth 当前递归深度，防止无限循环
     * @param {string} lastSenderId 上一条消息的发送者ID（用于排除自问自答）
     */
    async startGroupConversationChain(chatId, triggerMsg, depth = 0, lastSenderId = null, mentionedTargetId = null) {
        const chat = this.getChat(chatId);
        if (!chat || !chat.isGroup) return;

        // 从群聊设置读取最大深度，默认为 4
        const MAX_DEPTH = chat.maxConversationDepth || 4;
        if (depth >= MAX_DEPTH) {
            console.log(`[群聊对话链] 达到最大深度 ${MAX_DEPTH}，停止递归`);
                        return;
        }

        // 获取可发言成员（排除被禁言的）
        const availableMembers = this.getAvailableGroupMembers(chat);
        if (availableMembers.length === 0) return;

        // 仅排除上一条消息的发送者（防止连续自问自答），不排除其他已发言成员
        const eligibleMembers = lastSenderId
            ? availableMembers.filter(id => id !== lastSenderId)
            : availableMembers;

        if (eligibleMembers.length === 0) {
            console.log(`[群聊对话链] 排除发送者后无可用成员，结束`);
            return;
        }

        
        // 计算本轮哪些成员愿意发言
        const willingMembers = await this.selectWillingMembers(chat, eligibleMembers, triggerMsg);
        if (willingMembers.length === 0) {
            console.debug(`[群聊对话链] 本轮无人愿意发言`);

            // 冷场复活：如果当前深度不超过 2，说明大家还没聊开就冷了，尝试自然话题发散
            if (depth <= 2) {
                const forcedSpeaker = await this.forceNewTopic(chat, eligibleMembers, depth);
                if (forcedSpeaker) {
                    // 成功强制发言后，继续递归下一轮
                    return;
                }
            }

            console.debug(`[群聊对话链] 冷场复活失败或已达深度限制，结束`);
            return;
        }

        // 按随机顺序（模拟真实聊天节奏）依次让成员发言
        const shuffled = [...willingMembers].sort(() => Math.random() - 0.5);
        for (const memberId of shuffled) {
            // 防重复锁
            const key = `${chatId}_${memberId}_${depth}`;
            if (this.generatingReplyForMember?.has(key)) continue;
            this.generatingReplyForMember = this.generatingReplyForMember || new Set();
            this.generatingReplyForMember.add(key);

            try {
                const reply = await this.callAIForGroupMember(memberId, chatId, triggerMsg, mentionedTargetId);
                if (reply) {
                    // 将回复添加到群聊消息中
                    await this.addMessageWithEmotion(chatId, reply, false, memberId);

                    // 更新最后活跃时间
                    chat.lastActivityTimestamp = new Date().toISOString();

                    // 渲染消息
                    if (this.currentChat && this.currentChat.id === chatId) {
                        this.renderMessages(this.currentChat);
                        this.scrollToBottom();
                    }

                    // 刷新聊天列表，更新未读计数和最后消息
                    this.renderChatList();
                    this.updateMessageBadge();

                    // 用本条回复作为新的触发消息，递归调用下一轮
                    // 注意：这里传递的是原始回复文本（已剥离情绪标签）
                    const cleanReply = reply.replace(/\[emotion:.*?\]/gi, '').trim();
                    // 新增加工：为下一位发言者明确消息来源
                    const speakerName = this.getMemberDisplayInfo(memberId).name;
                    const contextualizedReply = `（${speakerName} 说：${cleanReply}）`;

                    // 延迟一小段时间再触发下一轮，模拟真实对话间隔
                    const speedFactor = chat.replySpeedFactor || 1.0;
                    const baseDelay = 2000; // 基础2秒
                    const delay = baseDelay * speedFactor;
                    console.log(`[群聊节奏] 群名称：${chat.name}，快慢系数：${speedFactor}，本轮延迟：${delay}ms`);

                    setTimeout(() => {
                        // 关键修改：将 contextualizedReply 作为新的触发消息传入，并传递 mentionedTargetId 以保持点名状态
                        this.startGroupConversationChain(chatId, contextualizedReply, depth + 1, memberId, mentionedTargetId);
                    }, delay);

                    
                    // 本轮只让一个成员发言后即跳出，避免多个成员同时发言导致混乱
                    // 若希望多人同时发言，可将此 break 注释，但需注意递归爆炸
                    break;
                }
            } catch (error) {
                console.error(`[群聊对话链] 成员 ${memberId} 生成回复失败`, error);
            } finally {
                this.generatingReplyForMember.delete(key);
            }
        }
    }

    /**
     * 强制选择一个成员开启新话题（用于冷场复活）
     * @param {Object} chat 群聊对象
     * @param {Array} eligibleMembers 当前可发言成员列表
     * @param {number} depth 当前对话深度
     * @returns {boolean} 是否成功触发发言
     */
    /**
     * 自然话题发散：当冷场时，选一个成员基于最近聊天内容引申新话题
     */
    async forceNewTopic(chat, eligibleMembers, depth) {
        if (!eligibleMembers || eligibleMembers.length === 0) return false;

        const memberId = eligibleMembers[Math.floor(Math.random() * eligibleMembers.length)];
        const member = this.getChat(memberId) || this.findNPCData(memberId);
        if (!member) return false;

        // 获取最近几条消息作为上下文（取最近5条非系统消息）
        const recentMsgs = chat.messages
            .filter(m => !m.isSystem && m.type !== 'pat')
            .slice(-5)
            .map(m => {
                const senderInfo = this.getMemberDisplayInfo(m.senderId || (m.isMe ? 'user_mummy' : null));
                return `${senderInfo.name}: ${m.text || m.content}`;
            })
            .join('\n');

        // 构建自然发散提示：不是"开启新话题"，而是"接续或引申话题"
        const prompt = `（系统背景：群聊突然安静了。你需要根据最近的聊天内容，自然地延续或稍微引申话题，不要突兀切换。
最近对话：
${recentMsgs || '（暂无对话）'}

你可以：
- 对上面某条消息发表不同意见或质疑（比如"但我觉得橘猫太胖了不好"）
- 补充相关经历（比如"我昨天也看到一只超可爱的三花！"）
- 开玩笑或吐槽（比如"你们怎么天天聊猫，是不是想偷我家的？"）
- 把话题往相近领域引申（比如从猫聊到养猫经验、宠物医院、猫粮品牌等）
- 如果实在没想法，就分享一件自己今天遇到的琐事（但避免"天气"类无聊内容）

请说一句话，要口语化，像真人聊天，不要附和、不要只是"确实""我也"。

【注意】你的发言必须独特，不要重复其他人刚说过的内容。）`;

        try {
            const reply = await this.callAIForGroupMember(memberId, chat.id, prompt);
            if (reply) {
                await this.addMessageWithEmotion(chat.id, reply, false, memberId);
                chat.lastActivityTimestamp = new Date().toISOString();

                if (this.currentChat && this.currentChat.id === chat.id) {
                    this.renderMessages(this.currentChat);
                    this.scrollToBottom();
                }

                const cleanReply = reply.replace(/\[emotion:.*?\]/gi, '').trim();
                const speedFactor = chat.replySpeedFactor || 1.0;
                const baseDelay = 2000;
                const delay = baseDelay * speedFactor;

                setTimeout(() => {
                    this.startGroupConversationChain(chat.id, cleanReply, depth + 1, memberId);
                }, delay);

                return true;
            }
        } catch (error) {
            console.error('[自然话题发散] 失败', error);
        }
        return false;
    }

    /**
     * 获取群内可发言成员（未被禁言）
     */
    getAvailableGroupMembers(chat) {
        if (!chat.members) return [];
        const now = Date.now();
        return chat.members.filter(id => {
            if (id === 'user_mummy') return false; // 妈咪不参与自动接话
            const mute = chat.mutedMembers?.[id];
            if (mute && (mute === 'forever' || mute > now)) return false;
            return true;
        });
    }

    /**
     * 评估并筛选愿意发言的成员（基于性格、心情、关系等）
     */
    /**
     * 评估并筛选愿意发言的成员（基于性格、心情、关系等）
     * @param {Object} chat 群聊对象
     * @param {Array} availableMembers 可发言成员ID列表
     * @param {string} triggerMsg 触发消息内容
     * @returns {Array} 愿意发言的成员ID数组
     */
    async selectWillingMembers(chat, availableMembers, triggerMsg) {
        const willing = [];

        // 判断是否为群事件（由 triggerGroupEventDiscussion 发出的特殊前缀）
        const isGroupEvent = triggerMsg.includes('（大家注意，');

        for (const memberId of availableMembers) {
            let member = this.getChat(memberId);
            let isNPC = false;
            let npcData = null;

            // 处理 NPC（如果 getChat 返回 null）
            if (!member) {
                const info = this.getMemberDisplayInfo(memberId);
                if (info.isNPC) {
                    isNPC = true;
                    npcData = this.findNPCData(memberId);
                    const personalityPrompt = npcData?.setting || '一个普通的群成员';
                    member = {
                        id: memberId,
                        name: info.name,
                        avatar: info.avatar,
                        personalityPrompt: personalityPrompt,
                        replyTemp: 0.5,
                        emojiFreq: 0.5,
                        partnerIds: [],
                        worldId: npcData?.worldId || null
                    };
                    // 调试日志
                    console.log(`[NPC发言] 构造临时成员对象: ${info.name}，设定: ${personalityPrompt}`);
                } else {
                    continue; // 既不是 OC 也不是 NPC，跳过
                }
            }

            // 基础概率：群事件时显著提高，日常聊天也提高接话意愿
            let probability = isGroupEvent ? 0.6 : 0.5;

            // NPC 特殊处理：提升发言概率至至少 0.7
            if (isNPC) {
                probability = Math.max(probability, 0.7);

                // 如果 NPC 设定中包含积极互动描述，再小幅提升概率
                if (npcData?.setting && npcData.setting.includes('积极')) {
                    probability += 0.1;
                }
                if (npcData?.relationToOC && npcData.relationToOC.includes('友好')) {
                    probability += 0.1;
                }
            }

            // 被 @ 检查
            const memberName = member.name || (member.nickname || member.remarkName || member.id);
            const mentionPattern = /@(\S+)/g;
            const mentions = [...triggerMsg.matchAll(mentionPattern)];
            const mentionedNames = mentions.map(m => m[1]);
            if (mentionedNames.some(name => name.includes(memberName) || memberName.includes(name))) {
                probability = 0.95; // 被 @ 几乎必回
            }
            // 名字被提及（但未被 @）
            else if (triggerMsg.includes(memberName)) {
                probability = Math.max(probability, 0.8);
            }
            // 配对角色相关（仅 OC）
            else if (!isNPC && member.partnerIds && member.partnerIds.length > 0) {
                const partners = member.partnerIds.map(pid => this.getChat(pid)).filter(p => p);
                const partnerNames = partners.map(p => p.nickname || p.remarkName || p.name);
                if (partnerNames.some(name => triggerMsg.includes(name))) {
                    probability = Math.max(probability, 0.7);
                }
            }

            // 心情影响
            const todayMood = this.getTodayMoodDiary(memberId);
            if (todayMood) {
                const mood = todayMood.mood;
                if (['开心', '兴奋', '幸福', '活力'].includes(mood)) {
                    probability += 0.2;
                } else if (['愤怒', '烦躁', '生气'].includes(mood)) {
                    probability += 0.15;
                } else if (['伤心', '难过', '疲惫'].includes(mood)) {
                    probability -= 0.1;
                }
            }

            // 群聊快慢系数影响（系数越高，发言意愿越低）
            const speedFactor = chat.replySpeedFactor || 1.0;
            probability = probability / speedFactor;

            // OC 同世界观加成
            if (!isNPC && member && member.worldId) {
                const world = this.worldBooks?.find(w => w.id === member.worldId);
                if (world && world.name) {
                    if (triggerMsg.includes(world.name)) {
                        probability = Math.max(probability, 0.9);
                    }
                }
            }

            // 限制概率范围
            probability = Math.min(1.0, Math.max(0.1, probability));

            // 新增：NPC增强发言意愿逻辑（在最终随机判断之前）
            if (isNPC) {
                // 1. 概率乘以1.5（提升50%），但不超过1.0
                probability = Math.min(1.0, probability * 1.5);

                // 2. 检查触发消息是否包含NPC名字或世界观名称
                const worldName = npcData?.worldName || '';
                if (triggerMsg.includes(memberName) || (worldName && triggerMsg.includes(worldName))) {
                    probability = 0.95; // 几乎必回
                }

                // 3. 心情影响减弱：如果是"平静"，额外增加0.1
                if (todayMood && todayMood.mood === '平静') {
                    probability += 0.1;
                }
            }

            // 最终随机判断
            if (Math.random() < probability) {
                willing.push(memberId);
            }
        }
        return willing;
    }

    /**
     * 触发群事件讨论
     * 当群内发生特定事件（如修改公告、禁言等）后调用，让群成员对此发表看法
     * @param {string} chatId 群聊ID
     * @param {string} eventDescription 事件描述
     */
    triggerGroupEventDiscussion(chatId, eventDescription) {
        const chat = this.getChat(chatId);
        if (!chat || !chat.isGroup) return;

        // 【新增】保存原始设置
        const originalDepth = chat.maxConversationDepth;
        const originalSpeed = chat.replySpeedFactor;

        // 【新增】临时提升对话深度和回复速度（更热烈）
        chat.maxConversationDepth = Math.max(originalDepth || 4, 6); // 至少6轮
        chat.replySpeedFactor = 0.6; // 回复更快

        
        const naturalTrigger = `（大家注意，${eventDescription}）`;
        this.triggerGroupReplies(chatId, naturalTrigger);

        // 【新增】在触发后，延迟一段时间恢复原始设置
        setTimeout(() => {
            const currentChat = this.getChat(chatId);
            if (currentChat) {
                currentChat.maxConversationDepth = originalDepth;
                currentChat.replySpeedFactor = originalSpeed;
            }
        }, 10000); // 10秒后恢复，足够完成讨论
    }

    /**
     * 生成单个群成员的回复
     * @param {string} chatId 群聊ID
     * @param {string} memberId 成员ID
     * @param {string} triggerMsg 触发消息
     */
    async callAIForGroupMember(memberId, chatId, triggerMsg, mentionedTargetId = null) {
        const settings = this.mammySettings;
        if (!settings.apiUrl || !settings.apiKey || !settings.modelName) {
            console.warn('API 未配置，群成员无法发言');
            return '';
        }

        let memberChat = this.getChat(memberId);
        const groupChat = this.getChat(chatId);
        // 允许 memberChat 为 null（NPC 场景），由 getMemberContextPrompt 处理
        if (!groupChat) return '';

        // 新增：如果是NPC且getChat返回undefined，构造临时成员对象
        if (!memberChat && memberId.startsWith('npc_')) {
            const info = this.getMemberDisplayInfo(memberId);
            const npcData = this.findNPCData(memberId);
            if (info.isNPC) {
                // 获取该 NPC 在当前群聊中的个性化设置
                const npcSettings = groupChat.npcSettings?.[memberId] || {};
                memberChat = {
                    id: memberId,
                    name: info.name,
                    personalityPrompt: npcData?.setting || '一个普通的群成员',
                    replyTemp: npcSettings.replyTemp ?? 0.5,
                    emojiFreq: npcSettings.emojiFreq ?? 0.5,
                    imageFrequency: npcSettings.imageFrequency ?? 0,
                    videoFrequency: npcSettings.videoFrequency ?? 0
                };
            }
        }

        
        const systemPrompt = this.getMemberContextPrompt(memberId, chatId);
        if (!systemPrompt) return '';

        // 构建历史消息上下文（滑动窗口）
        const contextLength = this.mammySettings?.autoGenerate?.contextLength || 10;
        let historyMessages = [];
        if (groupChat && Array.isArray(groupChat.messages)) {
            const recentMessages = groupChat.messages.slice(-contextLength);
            historyMessages = recentMessages
                .filter(msg => {
                    // 过滤掉纯表情消息（可能干扰 AI 理解上下文）
                    const isPureEmoji = /^[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\s]+$/u.test(msg.text || msg.content || '');
                    return !isPureEmoji;
                })
                .map(msg => {
                    const isMe = msg.isMe;
                    let senderName = isMe ? '妈咪' : null;
                    if (!isMe && msg.senderId) {
                        const senderInfo = this.getMemberDisplayInfo(msg.senderId);
                        senderName = senderInfo.name;
                    }
                    const content = msg.text || msg.content || '';
                    // 为群聊消息添加发言者前缀，帮助 AI 区分说话人
                    const formattedContent = isMe ? content : `${senderName}：${content}`;
                    return {
                        role: isMe ? 'user' : 'assistant',
                        content: formattedContent
                    };
                });
        }

        const memberNameForLog = memberChat ? (memberChat.nickname || memberChat.remarkName || memberChat.name) : this.getMemberDisplayInfo(memberId).name;
        const userMessage = triggerMsg + `\n\n【极其重要】你的回复末尾必须加上一个英文情绪标签，格式为 [emotion:xxx]（例如 [emotion:happy]）。只能使用以下英文单词之一：happy, sad, angry, surprised, excited, touched, lonely, anxious, proud, embarrassed, frustrated, nostalgic, calm, hopeful, jealous, disappointed, confused, bored, tired, energetic, curious, grateful, annoyed, scared, worried, relaxed, amused, sympathetic, shocked, envious, betrayed, adored, rejected, accepted, free, trapped, peaceful, restless。绝对不要使用中文！这个标签不会显示给用户。\n\n另外，你的回复内容本身必须纯文本，不能包含任何括号、动作描写或替他人发言。`;

        const messages = [
            { role: "system", content: systemPrompt },
            ...historyMessages,
            { role: "user", content: userMessage }
        ];

        try {
            console.log(`[群成员AI请求] 成员: ${memberNameForLog}, 触发消息: ${triggerMsg}`);
            const settings = this.mammySettings;
            const response = await fetch(settings.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${settings.apiKey}`
                },
                body: JSON.stringify({
                    model: settings.modelName,
                    messages: messages,
                    temperature: Math.min(1.0, (memberChat.replyTemp || 0.5) + 0.2), // 提高0.2以增加多样性
                    presence_penalty: 0.6,   // 鼓励谈论新话题
                    frequency_penalty: 0.5   // 抑制重复词语
                })
            });
            const data = await response.json();
            let reply = data.choices[0].message.content;

            // === 关键词检测代码 ===
            const memberNameLower = (memberChat?.name || '').toLowerCase();
            const triggerMsgLower = triggerMsg.toLowerCase();
            // 严格点名：只检查是否 @ 了该成员
            const isMentioned = triggerMsg.includes('@' + memberChat?.name) || memberId === mentionedTargetId;

            // 定义关键词数组（提前定义，避免引用错误）
            const imageKeywords = ['照片', '图片', '图', '拍', '看看', '发图', '发照片', '晒图', '发张', '拍照', '摄影', '快发', '给我看'];
            const videoKeywords = ['视频', '录像', '录影', '发视频', '小视频', '录一段', '拍个视频', '拍视频', '短片', '录个像', 'vlog', '视频看看', '视频给我'];

            if (isMentioned) {
                const allText = (triggerMsgLower + ' ' + reply.toLowerCase());
                let hasImage = false, hasVideo = false;
                for (let kw of imageKeywords) {
                    if (allText.includes(kw)) { hasImage = true; break; }
                }
                for (let kw of videoKeywords) {
                    if (allText.includes(kw)) { hasVideo = true; break; }
                }
                console.log(`[媒体触发调试] 成员：${memberChat?.name}，allText：${allText}，image匹配：${imageKeywords.filter(kw => allText.includes(kw))}，video匹配：${videoKeywords.filter(kw => allText.includes(kw))}`);
                console.log(`[媒体触发] 成员：${memberChat?.name}，被点名：${isMentioned}，hasImage：${hasImage}，hasVideo：${hasVideo}`);
                if (hasImage || hasVideo) {
                    // 优先发送视频（如果视频关键词被触发）
                    const mediaType = hasVideo ? 'video' : 'image';
                    setTimeout(() => {
                        this.sendAIMediaCard(chatId, mediaType, true, memberId);
                    }, 200);
                }
            }
            // === 关键词检测代码结束 ===

            console.log(`[群成员AI响应] ${memberNameForLog}: ${reply}`);
            // 清理意外保留的不完整 [em 标记
            reply = reply.replace(/\[em[^\]]*$/gi, ''); // 移除不完整的 [emotion: 标签

            // 新增：降级处理 - 如果reply为空，使用简单回复
            if (!reply || reply.trim() === '') {
                const fallbackReplies = ['嗯。', '哦。', '大家好。', '有意思。', '这样啊。'];
                const randomReply = fallbackReplies[Math.floor(Math.random() * fallbackReplies.length)];
                console.log(`[群成员AI回复为空，使用降级回复] ${memberNameForLog}: ${randomReply}`);
                return randomReply;
            }

            // 未被点名时，根据频率主动发送图片/视频
            if (mentionedTargetId !== memberId) {
                let imageFreq = 0;
                let videoFreq = 0;
                const memberChat = this.getChat(memberId);
                if (memberChat) {
                    // OC 角色：使用角色设置中的频率
                    imageFreq = memberChat.imageFrequency ?? 0;
                    videoFreq = memberChat.videoFrequency ?? 0;
                } else {
                    // NPC：使用群聊 NPC 个性化设置
                    const npcSettings = groupChat?.npcSettings?.[memberId] || {};
                    imageFreq = npcSettings.imageFrequency ?? 0;
                    videoFreq = npcSettings.videoFrequency ?? 0;
                }
                // 分别判断图片和视频，各自独立概率
                if (Math.random() < imageFreq) {
                    // 异步发送，不阻塞回复
                    setTimeout(() => this.sendAIMediaCard(chatId, 'image', false, memberId), 300);
                }
                if (Math.random() < videoFreq) {
                    setTimeout(() => this.sendAIMediaCard(chatId, 'video', false, memberId), 300);
                }
            }

            return reply;
        } catch (e) {
            console.error(`[群成员AI调用失败] ${memberNameForLog}:`, e);
            // 新增：降级处理 - 异常时也使用简单回复
            const fallbackReplies = ['嗯。', '哦。', '大家好。', '有意思。', '这样啊。'];
            return fallbackReplies[Math.floor(Math.random() * fallbackReplies.length)];
        }
    }

    async generateMemberReply(chatId, memberId, triggerMsg) {
        try {
            const reply = await this.callAIForGroupMember(memberId, chatId, triggerMsg);
            if (reply) {
                // 使用 addMessageWithEmotion 处理情绪标签并发送表情
                await this.addMessageWithEmotion(chatId, reply, false, memberId);
                // 渲染消息
                if (this.currentChat && this.currentChat.id === chatId) {
                    this.renderMessages(this.currentChat);
                    this.scrollToBottom();
                }
            }
        } catch (error) {
            console.error('生成群成员回复失败:', error);
        }
    }

    /**
     * 分析群聊消息触发条件
     * @param {string} userMessage 用户消息
     * @param {Object} lastMessage 最后一条消息
     * @param {Array} availableMembers 可用成员列表
     * @returns {Object} 触发信息
     */
    analyzeTriggerCondition(userMessage, lastMessage, availableMembers) {
        const result = {
            shouldTrigger: false,
            probability: 0.3, // 基础概率 30%
            triggerMemberId: null
        };

        if (!userMessage || !availableMembers || availableMembers.length === 0) {
            return result;
        }

        // 新增：如果是群事件消息，强制高概率触发
        if (userMessage.startsWith('【群事件】')) {
            return {
                shouldTrigger: true,
                probability: 0.8,
                triggerMemberId: null // 让后续逻辑随机选择成员
            };
        }

        // 获取当前用户（妈咪）的聊天信息
        const mummyChat = this.getChat('user_mummy');
        const mummyNickname = mummyChat ? (mummyChat.nickname || '妈咪') : '妈咪';

        // 检查是否是妈咪发的消息
        const isMummyMessage = lastMessage && lastMessage.isMe;

        // 检查是否@了某个成员
        const mentionPattern = /@(\S+)/g;
        const mentions = [...userMessage.matchAll(mentionPattern)];
        const mentionedNames = mentions.map(match => match[1]);

        // 关键词触发分析
        let maxProbability = 0.3;
        let triggerMemberId = null;

        availableMembers.forEach(memberId => {
            const member = this.getChat(memberId);
            if (!member) return;

            let memberProbability = 0.3;
            const memberName = member.nickname || member.remarkName || member.name;

            // 检查是否@了该成员
            if (mentionedNames.some(name => name.includes(memberName) || memberName.includes(name))) {
                memberProbability = 0.9; // @成员，触发概率 90%
                triggerMemberId = memberId;
            }
            // 检查消息中是否提到成员名字
            else if (userMessage.includes(memberName)) {
                memberProbability = 0.8; // 提到名字，触发概率 80%
                triggerMemberId = memberId;
            }
            // 检查成员是否被配对角色提到
            else if (member.partnerIds && member.partnerIds.length > 0) {
                member.partnerIds.forEach(partnerId => {
                    const partner = this.getChat(partnerId);
                    if (partner) {
                        const partnerName = partner.nickname || partner.remarkName || partner.name;
                        if (userMessage.includes(partnerName)) {
                            memberProbability = Math.max(memberProbability, 0.6); // 提到配对角色，触发概率 60%
                        }
                    }
                });
            }

            maxProbability = Math.max(maxProbability, memberProbability);
        });

        // 如果最后一条是妈咪的消息，提高触发概率
        if (isMummyMessage) {
            maxProbability = Math.max(maxProbability, 0.5);
        }

        result.shouldTrigger = maxProbability > 0.3;
        result.probability = maxProbability;
        result.triggerMemberId = triggerMemberId;

        return result;
    }

    /**
     * 构建OC的AI提示词
     */
    buildPromptForOC(chat, contextType, extraContext = {}) {
        let prompt = '';

        // 基础角色设定
        const personality = chat.personalityPrompt || '性格普通';  // 关键：无性格时用默认值
        const worldId = chat.worldId || '';
        const partnerInfo = chat.partnerIds && chat.partnerIds.length > 0
            ? chat.partnerIds.map(id => {
                const partner = this.chats.find(c => c.id === id);
                if (!partner) return id;
                const gender = partner.gender || '';
                const partnerName = partner.nickname || partner.name;  // 优先昵称
                return gender ? `${partnerName}（${gender}）` : partnerName;
            }).join('、')
            : '';

        // 根据场景构建不同提示词
        switch (contextType) {
            case 'generate_dynamic':
                prompt = `你是${chat.nickname || chat.name}。${personality ? '性格：' + personality : ''}${partnerInfo ? ' 配对角色：' + partnerInfo : ''}${worldId ? ' 世界观：' + worldId : ''}

【重要】请先根据你的角色设定（性格、世界观、人际关系、当前处境等），推测你目前可能的生活状态和环境约束。例如：你是否被囚禁？是否有自由行动能力？生活条件是奢华还是困苦？日常活动范围在哪里？
然后，基于这个推测的状态，生成一条符合你真实处境的生活化朋友圈动态。内容必须是你在这个状态下能够实际做到的事情或产生的感受，禁止出现与你处境矛盾的行为（例如被囚禁却谈论出门逛街、无法接触唱片机却谈论听唱片等）。

要求：
- 禁止使用括号、动作描写、心理描写。
- 内容必须是日常生活中的小事，语气自然口语化，1-3句话。
- 避免与之前生成过的动态内容重复，尽量从不同生活场景中选择。

【多样性要求】请从以下生活场景中随机选择一种作为描述对象（不要总是流浪猫、医院、墓园）：窗外的风景、书桌一角、咖啡杯、天空的云、路边的花、书架上的书、手中的笔、夕阳、雨后的街道、厨房的炊具、宠物、植物、画作、乐器、运动器材、日常用品等。

示例（普通角色）："今天路过花店看到一束超好看的洋甘菊，心情都变好了～"
直接输出文本内容，不要加引号。

当前时间是 ${new Date().toLocaleString('zh-CN', { hour12: false })}。请确保你的回复符合当前时间段的语境。`;
                break;

            case 'comment_dynamic':
                const dynamicAuthorChat = extraContext.dynamicAuthorId ? this.getChat(extraContext.dynamicAuthorId) : null;
                let authorInfo = '';
                let relationshipHint = '';
                if (dynamicAuthorChat) {
                    const authorName = dynamicAuthorChat.nickname || dynamicAuthorChat.remarkName || dynamicAuthorChat.name;
                    const authorPersonality = dynamicAuthorChat.personalityPrompt ? `。性格：${dynamicAuthorChat.personalityPrompt}` : '';

                    // 获取世界观信息
                    let worldInfo = '';
                    if (dynamicAuthorChat.worldId) {
                        const world = this.worldBooks?.find(w => w.id === dynamicAuthorChat.worldId);
                        if (world) {
                            worldInfo = `。来自世界观「${world.name}」：${world.description || ''}`;
                        }
                    }

                    // 获取身份标签（配对角色/NPC等）
                    const isPartner = chat.partnerIds?.includes(dynamicAuthorChat.id);
                    let identityHint = '';
                    if (isPartner) {
                        identityHint = '。这是你的配对角色，你对TA有特殊的情感';
                    } else {
                        identityHint = '。这是一个普通朋友或陌生人，你与TA没有特殊关系';
                    }

                    relationshipHint = identityHint;
                    authorInfo = `${authorName}${authorPersonality}${worldInfo}`;
                } else {
                    authorInfo = extraContext.dynamicAuthor;
                    relationshipHint = '这是一个你不熟悉的人。';
                }

                prompt = `你是${chat.nickname || chat.name}。${personality ? '性格：' + personality : ''}

动态作者：${authorInfo}
${relationshipHint}
动态内容："${extraContext.dynamicContent}"

请根据你的性格和你与该作者的真实关系，决定是否要评论以及评论什么内容。
- 如果你不认识作者，或者内容与你无关，可以保持沉默（由系统判断概率），如果选择评论，语气应保持疏离或礼貌。
- 绝对不要把作者错认成你的配对角色或熟人，除非TA确实是。
- 评论要简短、口语化，1句话即可，不要重复动态原文。

示例：
你看到陌生人的动态："今天天气真好。"
你的评论（如果你性格开朗）："是啊，心情都变好了。"
你的评论（如果你性格冷漠）：（不评论）
你的评论（如果你只对熟人热情）：（不评论）

直接输出评论内容，不要加引号。

【绝对禁止】你的回复中不能出现任何括号、动作描写、心理描写、场景描述。只输出纯文本对话内容，就像正常聊天一样。`;
                break;

            case 'reply_comment':
                const isMummy = extraContext.isMummy || false;
                let replyTargetInfo = '';

                // 如果角色性格描述过长（超过300字符），进行摘要压缩
                let compressedPersonality = personality;
                if (personality.length > 300) {
                    compressedPersonality = personality.substring(0, 300) + '…（性格摘要）';
                }

                if (isMummy) {
                    replyTargetInfo = '妈咪（你的创造者）';
                } else {
                    const commentAuthorId = extraContext.commentAuthorId;
                    const commentAuthorChat = commentAuthorId ? this.getChat(commentAuthorId) : null;
                    if (commentAuthorChat) {
                        const targetName = commentAuthorChat.nickname || commentAuthorChat.remarkName || commentAuthorChat.name;
                        const targetPersonalityRaw = commentAuthorChat.personalityPrompt || '';
                        // 压缩对方角色性格
                        const targetPersonality = targetPersonalityRaw.length > 300 ?
                            `。性格：${targetPersonalityRaw.substring(0, 300)}…` :
                            (targetPersonalityRaw ? `。性格：${targetPersonalityRaw}` : '');

                        // 获取世界观信息
                        let worldInfo = '';
                        if (commentAuthorChat.worldId) {
                            const world = this.worldBooks?.find(w => w.id === commentAuthorChat.worldId);
                            if (world) {
                                const worldDesc = world.description || '';
                                // 压缩世界观描述
                                const compressedWorldDesc = worldDesc.length > 200 ?
                                    worldDesc.substring(0, 200) + '…' : worldDesc;
                                worldInfo = `。来自世界观「${world.name}」：${compressedWorldDesc}`;
                            }
                        }

                        const isPartner = chat.partnerIds?.includes(commentAuthorChat.id) ? '，是你的配对角色（你对TA有特殊的情感联系，回复语气应体现亲密关系）' : '';
                        replyTargetInfo = `${targetName}${targetPersonality}${worldInfo}${isPartner}`;
                    } else {
                        replyTargetInfo = extraContext.commentAuthor;
                    }
                }

                prompt = `你是${chat.nickname || chat.name}。${compressedPersonality ? '性格摘要：' + compressedPersonality : ''}

${replyTargetInfo} 评论了你："${extraContext.commentContent}"

【重要指令】
请根据你的性格和你对${replyTargetInfo}的认知，生成一条简短、口语化的回复（1-2句话）。
- 重要：你是在回复"${replyTargetInfo}"，请确认此人不是你的配对角色，除非系统明确告知你们是配对关系。不要用对待恋人或至亲的语气回复陌生人。
- 绝对不要重复或模仿对方评论中的原话或句式，必须用自己的语言表达。
- 回复内容要体现你对这个人的真实态度（例如：对陌生人可能冷淡，对朋友可能友好，对配对角色可能亲昵）。
- 如果你不认识对方或与对方不熟，回复应保持礼貌但疏离。
- 如果你觉得对方的话很无聊或与你无关，可以选择敷衍、无视或转移话题。
- 如果对方来自与你完全不同的世界观（例如你是现代人，对方是赛博仿生人），你的回复可以体现这种差异感（好奇、困惑、漠不关心等），但不要强行套用你世界的逻辑去理解对方。
- 只输出回复内容，不要加任何前缀或括号说明。

示例：
对方说："今天天气真好。"
你的回复（如果你性格开朗）："是啊，适合出去走走。"
你的回复（如果你性格阴郁）："关我什么事。"
你的回复（如果你不认识对方）："嗯。"

当前时间是 ${new Date().toLocaleString('zh-CN', { hour12: false })}。

【绝对禁止】你的回复中不能出现任何括号、动作描写、心理描写、场景描述。只输出纯文本对话内容，就像正常聊天一样。`;
                break;
        }

        // 长度检查
        if (prompt.length > 2000) {
            console.warn(`[Prompt过长] 场景: ${contextType}, 长度: ${prompt.length}, 可能被API截断`);
        }

        return prompt;
    }

    /**
     * 为单个OC生成AI动态
     */
    async generateDynamicForOC(chat) {
    try {
        const personality = chat.personalityPrompt || '性格普通';
        const worldDesc = chat.worldId ? (this.worldBooks.find(w => w.id === chat.worldId)?.description || '') : '';
        const partnerInfo = chat.partnerIds?.length > 0
            ? '配对角色：' + chat.partnerIds.map(pid => {
                const p = this.getChat(pid);
                return p ? (p.nickname || p.name) : pid;
            }).join('、')
            : '';

        // 数据驱动的类型选择逻辑
        let dynamicData = null;
        const hasMoodDiary = this.getTodayMoodDiary(chat.id);
        const hasTaskProgress = this.getTodayTaskProgress(chat.id);
        const hasMusicHistory = chat.musicHistory && chat.musicHistory.length > 0;

        // 如果存在对应数据，以70%概率强制选择对应类型
        const rand = Math.random();
        if (hasMoodDiary && rand < 0.7) {
            // 心情日记数据
            const todayMood = hasMoodDiary;
            if (todayMood.note && todayMood.note !== '今天没什么特别的心情') {
                dynamicData = {
                    type: 'mood',
                    content: '今天的心情'
                };
            }
        } else if (hasTaskProgress && hasTaskProgress.total > 0 && rand < 0.7) {
            // 任务进度数据
            const taskProgress = hasTaskProgress;
            if (taskProgress.total > 0) {
                dynamicData = {
                    type: 'task',
                    content: '今日任务进度'
                };
            }
        } else if (hasMusicHistory && rand < 0.7) {
            // 音乐历史数据
            const randomSong = this.getTopSongForCharacter(chat.id);
            if (randomSong) {
                dynamicData = {
                    type: 'music',
                    content: '分享一首歌'
                };
            }
        }

        // 如果未命中数据驱动，则调用AI生成
        if (!dynamicData) {
            const prompt = `你是${chat.nickname || chat.name}。${personality ? '性格：' + personality : ''}${partnerInfo ? ' 配对角色：' + partnerInfo : ''}${worldDesc ? ' 世界观：' + worldDesc : ''}
当前时间：${new Date().toLocaleString('zh-CN', { hour12: false })}

请根据你的角色设定、当前生活状态、世界观和近期经历，自由联想一个独特的、具体的画面或事件来作为动态内容。

画面必须是你在当前处境下能够亲眼看到、亲耳听到或亲身经历的，不能脱离世界观限制。

描述要客观具体，避免使用"可爱的"、"有趣的"等主观形容词，直接呈现画面细节。

严禁使用以下常见模板：流浪猫、墓园、窗外的雨、书桌一角、咖啡杯、夕阳、血迹、烟灰、雪茄、办公室、辞职信、棒球棍、墙纸、霓虹灯。

图片/视频的描述必须是你能够拍摄到的真实场景，长度不超过20字。

如果生成文字动态，内容要符合口语化日常表达，1-3句话。

可以随机选择以下类型：纯文字动态、图片动态、视频动态、音乐分享、心情分享、任务进度分享，各类型概率均等。

输出格式必须是严格的JSON对象，包含以下字段：

type: 字符串，可选值："text", "image", "video", "music", "mood", "task"

content: 字符串，如果是text类型则为动态正文；如果是image/video则必须是客观的画面描述（不超过20字）；如果是music/mood/task则写一句简短的推荐语（不超过20字）。

只输出JSON，不要任何额外文字。`;

            const aiResponse = await this.callAIForDynamic(prompt, { temperature: 0.8,  reasoning_effort: "low", stop: ["\n\n"] });

            if (aiResponse) {
                try {
                    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        dynamicData = JSON.parse(jsonMatch[0]);
                    }
                } catch (e) {
                    console.warn('动态JSON解析失败，采用随机类型', e);
                }
            }

            // 如果AI未返回有效JSON，随机分配类型
            if (!dynamicData || !dynamicData.type) {
                const types = ['text', 'image', 'video', 'music', 'mood', 'task'];
                const randomType = types[Math.floor(Math.random() * types.length)];
                let randomContent = '';
                switch (randomType) {
                    case 'text':
                        randomContent = '今天也是充满希望的一天。';
                        break;
                    case 'image':
                        randomContent = '随手拍的一张照片。';
                        break;
                    case 'video':
                        randomContent = '录了一段小视频。';
                        break;
                    case 'music':
                        randomContent = '分享一首好听的歌。';
                        break;
                    case 'mood':
                        randomContent = '今天心情还不错。';
                        break;
                    case 'task':
                        randomContent = '任务进度更新啦。';
                        break;
                }
                dynamicData = { type: randomType, content: randomContent };
            }
        }

        // 构建动态对象
        const baseDynamic = {
            id: Date.now() + Math.random(),
            author: this.getDynamicDisplayName(chat),
            authorId: chat.id,
            avatar: chat.avatar || '👤',
            time: this.getRelativeTime(new Date()),
            likes: 0,
            likedBy: [],
            comments: [],
            isLiked: false,
            isMe: false,
            timestamp: Date.now(),
            type: dynamicData.type
        };

        let finalDynamic = { ...baseDynamic };

        switch (dynamicData.type) {
            case 'text':
            case 'image':
            case 'video':
                finalDynamic.content = dynamicData.content;
                break;
            case 'music':
                const randomSong = this.getTopSongForCharacter(chat.id);
                if (randomSong) {
                    finalDynamic.content = dynamicData.content;
                    finalDynamic.musicData = randomSong;
                } else {
                    finalDynamic.type = 'text';
                    finalDynamic.content = '今天心情不错。';
                }
                break;
            case 'mood':
                const todayMood = this.getTodayMoodDiary(chat.id);
                if (todayMood) {
                    finalDynamic.content = dynamicData.content;
                    finalDynamic.moodData = todayMood;
                } else {
                    finalDynamic.type = 'text';
                    finalDynamic.content = '今天心情不错。';
                }
                break;
            case 'task':
                const taskProgress = this.getTodayTaskProgress(chat.id);
                if (taskProgress && taskProgress.total > 0) {
                    finalDynamic.content = dynamicData.content;
                    finalDynamic.taskData = taskProgress;
                } else {
                    finalDynamic.type = 'text';
                    finalDynamic.content = '今天任务完成了。';
                }
                break;
            default:
                finalDynamic.type = 'text';
                finalDynamic.content = dynamicData.content || '今天天气不错';
        }

        this.dynamics.push(finalDynamic);
        this.saveDynamics();          // 新增：保存到 localStorage
        this.renderDynamics();        // 新增：立即刷新界面
        this.showDynamicBadge();
        this.handlePairInteractions(finalDynamic);
        this.triggerRandomInteractionsForOCDynamic(finalDynamic);
        return finalDynamic;
    } catch (error) {
        console.error(`为角色 ${chat.name} 生成动态失败:`, error);
        return null;
    }
}

    // 获取角色听过的歌曲（从 musicHistory 中随机选择一首）
    getTopSongForCharacter(chatId) {
        const chat = this.getChat(chatId);
        if (!chat || !chat.musicHistory || chat.musicHistory.length === 0) {
            return null;
        }
        // 收集所有听过的歌曲（去重）
        const songSet = new Set();
        chat.musicHistory.forEach(record => {
            record.songs?.forEach(song => {
                const key = `${song.name}|${song.artist}`;
                songSet.add(key);
            });
        });
        if (songSet.size === 0) return null;
        // 随机选择一首
        const songArray = Array.from(songSet);
        const randomKey = songArray[Math.floor(Math.random() * songArray.length)];
        const [name, artist] = randomKey.split('|');
        return { name, artist };
    }

    // 获取今日心情日记
    getTodayMoodDiary(chatId) {
        const chat = this.getChat(chatId);
        const todayStr = new Date().toISOString().slice(0, 10);
        const diary = chat?.moodDiaries?.find(d => d.date === todayStr);
        return diary || { emoji: '😊', mood: '平静', note: '今天没什么特别的心情' };
    }

    // 获取今日任务清单进度
    getTodayTaskProgress(chatId) {
        const chat = this.getChat(chatId);
        const todayStr = new Date().toISOString().slice(0, 10);
        const taskList = chat?.taskLists?.find(t => t.date === todayStr);
        if (!taskList) return { total: 0, completed: 0, tasks: [] };
        const total = taskList.tasks.length;
        const completed = taskList.tasks.filter(t => t.completed).length;
        return { total, completed, tasks: taskList.tasks };
    }

    /**
     * 处理配对角色互动
     */
    async handlePairInteractions(dynamic) {
        const authorChat = this.chats.find(c => c.id === dynamic.authorId);
        if (!authorChat || !authorChat.partnerIds || authorChat.partnerIds.length === 0) {
            return;
        }

        // 捕获动态数据避免异步问题
        const dynamicId = dynamic.id;
        const dynamicContent = dynamic.content;

        // 为每个配对角色生成点赞和评论
        for (const partnerId of authorChat.partnerIds) {
            const partnerChat = this.chats.find(c => c.id === partnerId);
            if (!partnerChat) continue;

            // 随机延迟10-20秒点赞
            const likeDelay = Math.floor(Math.random() * 10000) + 10000;
            setTimeout(() => {
                this.simulateLikeFromUser(dynamicId, partnerChat);
            }, likeDelay);

            // 随机延迟15-30秒评论
            const commentDelay = Math.floor(Math.random() * 15000) + 15000;
            setTimeout(async () => {
                let success = false;
                for (let attempt = 0; attempt < 2; attempt++) {
                    const result = await this.simulateCommentFromUser(dynamicId, partnerChat, dynamicContent);
                    if (result !== false) { // simulateCommentFromUser 成功时不返回 false
                        success = true;
                        break;
                    }
                    await new Promise(r => setTimeout(r, 2000)); // 等2秒再试
                }
                if (!success) {
                    console.warn(`[配对评论失败] ${partnerChat.name} 未能评论动态 ${dynamicId}`);
                }
            }, commentDelay);
        }
    }

    /**
     * 获取动态显示名称
     */
    getDynamicDisplayName(chat) {
        if (!chat) return '未知';
        return chat.remarkName || chat.nickname || chat.name;
    }

    /**
     * 获取分页后的动态数据（倒序排列）
     */
    getPaginatedDynamics(page, pageSize) {
        const sorted = [...this.dynamics].sort((a, b) => b.timestamp - a.timestamp);
        const start = (page - 1) * pageSize;
        return sorted.slice(start, start + pageSize);
    }

    /**
     * 获取分页后的论坛帖子（倒序排列）
     */
    getPaginatedForumPosts(page, pageSize) {
        const sorted = [...this.forumPosts].sort((a, b) => {
            const aTime = new Date(a.timestamp || new Date(Date.now() - parseInt(a.time) * 60000));
            const bTime = new Date(b.timestamp || new Date(Date.now() - parseInt(b.time) * 60000));
            return bTime - aTime;
        });
        const start = (page - 1) * pageSize;
        return sorted.slice(start, start + pageSize);
    }

    /**
     * 模拟用户点赞
     */
    simulateLikeFromUser(dynamicId, userChat) {
        const dynamic = this.dynamics.find(d => d.id === dynamicId);
        if (!dynamic) return;

        // 检查是否已经点赞
        const userName = this.getDynamicDisplayName(userChat);
        if (dynamic.likedBy.includes(userName)) {
            console.log(`${userName} 已经点赞过该动态，跳过重复点赞`);
            return;
        }

        dynamic.likedBy.push(userName);
        dynamic.likes = dynamic.likedBy.length;
        dynamic.isLiked = dynamic.likedBy.includes('我');

        this.saveDynamics();
        this.renderDynamics();

        console.log(`${userName} 点赞了 ${dynamic.author} 的动态`);
    }

    /**
     * 模拟用户评论
     */
    async simulateCommentFromUser(dynamicId, userChat, dynamicContent) {
        // 重新获取最新的动态对象，确保数据是最新的
        const dynamic = this.dynamics.find(d => d.id === dynamicId);
        if (!dynamic) return;

        console.log(`[simulateCommentFromUser] 开始为 ${userChat.name} 生成评论，动态ID: ${dynamicId}`);

        // 检查该用户是否已经评论过
        if (dynamic.comments && dynamic.comments.some(comment => comment.authorId === userChat.id)) {
            console.log(`${userChat.name} 已经评论过该动态，跳过重复评论`);
            return;
        }

        try {
            // 构建评论提示词
            const commentPrompt = this.buildPromptForOC(userChat, 'comment_dynamic', {
                dynamicAuthor: dynamic.author,
                dynamicAuthorId: dynamic.authorId,  // 新增
                dynamicContent: dynamicContent
            });

            // 调用AI生成评论内容
            let commentContent = null;
            try {
                commentContent = await this.callAIForDynamic(commentPrompt);
            } catch (error) {
                console.error(`[评论生成异常] ${userChat.name}:`, error);
                commentContent = null;
            }

            // 如果是配对角色，强制必须有评论
            const isPartner = dynamic.authorId && userChat.partnerIds?.includes(dynamic.authorId);
            if (isPartner) {
                // 如果 AI 返回了拒绝评论的内容或为空，则强制生成一条符合关系的评论
                const rejectPatterns = ['（不评论）', '不评论', '保持沉默', '...', '。', ''];
                if (!commentContent || rejectPatterns.includes(commentContent.trim())) {
                    console.warn(`[配对角色强制评论] ${userChat.name} 原本输出拒绝评论，将重新生成或使用默认语句`);
                    // 尝试重新生成一次，使用更直接的提示
                    const forcePrompt = `你是${userChat.name}，你的配对角色${dynamic.author}发了一条动态："${dynamic.content}"。作为TA的恋人/伴侣，你必须回复一句话，不能沉默。回复要符合你的性格，简短口语化。直接输出内容，不要引号。`;
                    let retryContent = await this.callAIForDynamic(forcePrompt);
                    if (!retryContent || rejectPatterns.includes(retryContent.trim())) {
                        // 仍失败则使用预设语句
                        const defaultComments = ['嗯。', '在。', '…', '（轻轻点头）', '我在。'];
                        retryContent = defaultComments[Math.floor(Math.random() * defaultComments.length)];
                    }
                    commentContent = retryContent;
                }
            }

            // 如果 AI 返回了"不评论"或空内容，则强制生成一条简单回复
            if (!commentContent || commentContent.includes('不评论') || commentContent.trim() === '') {
                if (isPartner) {
                    commentContent = '……'; // 配对角色必须有点回应
                } else {
                    console.log(`[评论跳过] ${userChat.name} 选择不评论`);
                    return; // 非配对角色尊重 AI 决定
                }
            }

            // 检查是否已存在相同内容的评论
            if (dynamic.comments && dynamic.comments.some(comment =>
                comment.authorId === userChat.id && comment.content === commentContent)) {
                console.log(`${userChat.name} 已经发表过相同内容的评论，跳过`);
                return false;
            }

            // 添加评论
            const newComment = {
                id: 'cmt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                authorId: userChat.id,
                authorName: this.getDynamicDisplayName(userChat),
                content: commentContent,
                timestamp: Date.now()
            };

            if (!dynamic.comments) dynamic.comments = [];
            dynamic.comments.push(newComment);
            this.saveDynamics();
            this.renderDynamics();

            console.log(`${userChat.name} 评论了 ${dynamic.author} 的动态: ${commentContent}`);
            console.log(`[评论成功] ${userChat.name} 评论了 ${dynamic.author} 的动态: "${commentContent}"`);

            // *** 关键修改：由动态作者回复这条评论，而不是评论者自己回复自己 ***
            const replyDelay = Math.floor(Math.random() * 10000) + 10000;
            setTimeout(async () => {
                const authorChat = this.getChat(dynamic.authorId);
                if (!authorChat || authorChat.id === newComment.authorId) return;

                // 检查评论者是否是作者的配对角色
                const isPartner = authorChat.partnerIds && authorChat.partnerIds.includes(userChat.id);

                // 配对角色强制回复，非配对角色以40%概率随机回复
                const shouldReply = isPartner ? true : (Math.random() < 0.4);

                if (shouldReply) {
                    await this.simulateReplyFromDynamicAuthor(dynamic, authorChat, newComment);
                }
            }, replyDelay);

        } catch (error) {
            console.error(`生成评论失败:`, error);
            return false;
        }

        return true;
    }

    /**
     * 模拟动态作者回复某条评论
     */
    async simulateReplyFromDynamicAuthor(dynamic, authorChat, targetComment) {
        // 防止作者回复自己的评论
        if (authorChat.id === targetComment.authorId) {
            console.log(`作者 ${authorChat.name} 跳过回复自己的评论`);
            return;
        }

        try {
            // 深拷贝目标评论，防止污染
            const safeComment = JSON.parse(JSON.stringify(targetComment));

            const replyPrompt = this.buildPromptForOC(authorChat, 'reply_comment', {
                commentAuthor: safeComment.authorName,
                commentAuthorId: safeComment.authorId,  // 新增
                commentContent: safeComment.content,
                originalDynamic: dynamic.content,
                isMummy: false
            });

            const replyContent = await this.callAIForDynamic(replyPrompt);
            if (!replyContent) return;

            // 如果 AI 返回了"不回复"或空内容，则强制生成一条简单回复
            let finalReplyContent = replyContent;
            if (!finalReplyContent || finalReplyContent.includes('不回复') || finalReplyContent.trim() === '') {
                // 检查被回复者是否是作者的配对角色
                const isPartner = authorChat.partnerIds?.includes(safeComment.authorId);
                if (isPartner) {
                    finalReplyContent = '……'; // 配对角色必须有点回应
                } else {
                    console.log(`[回复跳过] ${authorChat.name} 选择不回复`);
                    return; // 非配对角色尊重 AI 决定
                }
            }

            const replyComment = {
                authorId: authorChat.id,
                authorName: this.getDynamicDisplayName(authorChat),
                content: finalReplyContent,
                timestamp: Date.now(),
                replyTo: safeComment.authorName
            };

            dynamic.comments.push(replyComment);
            this.saveDynamics();
            this.renderDynamics();

            console.log(`作者 ${authorChat.name} 回复了 ${safeComment.authorName} 的评论: ${replyContent}`);

        } catch (error) {
            console.error(`作者回复失败:`, error);
        }
    }

    /*
     * 模拟被回复的评论作者回复（由被回复者回应）
     * 此方法已不再使用，功能由 simulateReplyFromDynamicAuthor 替代
     */
    /*
    async simulateReplyFromCommentAuthor(dynamic, parentComment) {
        const replyAuthorChat = this.getChat(parentComment.authorId);
        if (!replyAuthorChat) return;

        // 防止妈咪替自己回复
        if (replyAuthorChat.id === 'user_mummy') {
            return;
        }

        // 关键：深拷贝一份 parentComment，避免异步过程中被外部修改
        const safeParentComment = JSON.parse(JSON.stringify(parentComment));

        try {
            // 明确被回复者的名字和内容
            const targetAuthorName = safeParentComment.authorName;
            const targetContent = safeParentComment.content;

            // 构建提示词
            const replyPrompt = this.buildPromptForOC(replyAuthorChat, 'reply_comment', {
                commentAuthor: targetAuthorName,    // 被回复的人
                commentContent: targetContent,      // 被回复的内容
                originalDynamic: dynamic.content,
                isMummy: safeParentComment.authorId === 'user_mummy'
            });

            const replyContent = await this.callAIForDynamic(replyPrompt);
            if (!replyContent) return;

            const replyComment = {
                authorId: replyAuthorChat.id,
                authorName: this.getDynamicDisplayName(replyAuthorChat),
                content: replyContent,
                timestamp: Date.now(),
                replyTo: targetAuthorName   // 正确指向被回复者
            };

            dynamic.comments.push(replyComment);
            this.saveDynamics();
            this.renderDynamics();

            console.log(`${replyAuthorChat.name} 回复了 ${targetAuthorName} 的评论: ${replyContent}`);

        } catch (error) {
            console.error(`生成回复失败:`, error);
        }
    }

    /**
     * AI判断角色是否会与动态互动
     */
    async shouldInteract(chat, dynamic, interactionType) {
        try {
            if (!chat) return false;
            const authorChat = this.getChat(dynamic.authorId);
            if (!authorChat) return false;

            // 构建详细的角色上下文，供 AI 做出个性化判断
            const personality = chat.personalityPrompt || '性格普通';
            const worldId = chat.worldId || '';
            let worldDesc = '';
            if (worldId) {
                const world = this.worldBooks?.find(w => w.id === worldId);
                if (world && world.description) worldDesc = world.description;
            }
            const partnerInfo = chat.partnerIds?.length > 0
                ? '配对角色：' + chat.partnerIds.map(pid => {
                    const p = this.getChat(pid);
                    return p ? (p.nickname || p.name) : pid;
                }).join('、')
                : '';
            const relationship = authorChat.partnerIds?.includes(chat.id) ? '配对角色' : '普通朋友/路人';

            let actionPrompt = '';
            if (interactionType === 'like') {
                actionPrompt = `请根据以上设定，判断你是否会给这条动态点赞。注意：点赞代表欣赏、赞同或单纯想互动。`;
            } else {
                actionPrompt = `请根据以上设定，判断你是否会给这条动态写一条评论。注意：评论代表你想表达看法或互动。`;
            }

            const prompt = `你是${chat.nickname || chat.name}。
性格：${personality}
${worldDesc ? '世界观：' + worldDesc : ''}
${partnerInfo ? partnerInfo : ''}
你与动态作者的关系：${relationship}
当前动态内容："${dynamic.content}"

${actionPrompt}
请站在你的角色视角，结合你的性格、喜好、习惯和当前心情，做出判断。
输出必须是一个严格的JSON对象，格式为：{"willInteract": true} 或 {"willInteract": false}。
不要输出任何其他文字或解释。`;

            // 调用AI，temperature设为0.3使判断相对稳定但保留个性空间
            const result = await this.callAIForDynamic(prompt, { temperature: 0.3 });

            if (!result) {
                // AI调用失败，采用保守默认：仅20%概率互动
                console.warn('shouldInteract AI调用失败，使用默认概率');
                return Math.random() < 0.2;
            }

            // 解析JSON
            try {
                const jsonMatch = result.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    return parsed.willInteract === true;
                }
            } catch (e) {
                console.warn('shouldInteract JSON解析失败，使用默认概率', e);
            }
            return Math.random() < 0.2;
        } catch (error) {
            console.error('shouldInteract 执行出错，使用默认概率', error);
            return Math.random() < 0.2;
        }
    }

    /**
     * 触发OC动态的非配对角色AI互动
     */
    async triggerRandomInteractionsForOCDynamic(dynamic) {
        const authorChat = this.getChat(dynamic.authorId);
        if (!authorChat) return;

        // 获取所有非配对单人角色（排除作者和配对角色）
        const excludedIds = new Set([dynamic.authorId, ...(authorChat.partnerIds || [])]);
        const otherContacts = this.contacts.filter(c =>
            !c.isGroup && c.id !== 'user_mummy' && !excludedIds.has(c.id)
        );

        // 捕获动态数据避免异步问题
        const dynamicId = dynamic.id;
        const dynamicContent = dynamic.content;

        for (const contact of otherContacts) {
            const chat = this.getChat(contact.id);
            // 防御检查：如果chat不存在，跳过该角色
            if (!chat) {
                continue;
            }
            // AI判断是否点赞
            const willLike = await this.shouldInteract(chat, dynamic, 'like');
            if (willLike) {
                const likeDelay = Math.floor(Math.random() * 10000) + 10000;
                setTimeout(() => {
                    this.simulateLikeFromUser(dynamicId, chat);
                }, likeDelay);
            }

            // AI判断是否评论
            const willComment = await this.shouldInteract(chat, dynamic, 'comment');
            if (willComment) {
                const commentDelay = Math.floor(Math.random() * 15000) + 15000;
                setTimeout(async () => {
                    await this.simulateCommentFromUser(dynamicId, chat, dynamicContent);
                }, commentDelay);
            }

            // AI判断是否转发
            const willForward = await this.shouldForward(chat, dynamic);
            if (willForward) {
                const forwardDelay = Math.floor(Math.random() * 20000) + 20000; // 20-40秒延迟
                setTimeout(async () => {
                    await this.forwardDynamicAsCharacter(chat, dynamic);
                }, forwardDelay);
            }
        }
    }

    /**
     * 触发妈咪动态的AI随机互动
     */
    async triggerRandomInteractionsForMummyDynamic(dynamic) {
        const ocContacts = this.contacts.filter(c => !c.isGroup && c.id !== 'user_mummy');

        for (const contact of ocContacts) {
            const chat = this.getChat(contact.id);
            // 防御检查：如果chat不存在，跳过该角色
            if (!chat) {
                continue;
            }
            // AI判断是否点赞
            const willLike = await this.shouldInteract(chat, dynamic, 'like');
            if (willLike) {
                const likeDelay = Math.floor(Math.random() * 10000) + 10000;
                setTimeout(() => {
                    this.simulateLikeFromUser(dynamic.id, chat);
                }, likeDelay);
            }

            // AI判断是否评论
            const willComment = await this.shouldInteract(chat, dynamic, 'comment');
            if (willComment) {
                const commentDelay = Math.floor(Math.random() * 15000) + 15000;
                await new Promise(resolve => setTimeout(resolve, commentDelay));
                const latestDynamic = this.dynamics.find(d => d.id === dynamic.id);
                if (latestDynamic) {
                    await this.simulateCommentFromUser(latestDynamic.id, chat, latestDynamic.content);
                }
            }

            // AI判断是否转发
            const willForward = await this.shouldForward(chat, dynamic);
            if (willForward) {
                const forwardDelay = Math.floor(Math.random() * 20000) + 20000; // 20-40秒延迟
                setTimeout(async () => {
                    await this.forwardDynamicAsCharacter(chat, dynamic);
                }, forwardDelay);
            }
        }
    }

    /**
     * 判断角色是否要转发动态
     * @param {Object} chat - 角色聊天对象
     * @param {Object} dynamic - 动态对象
     * @returns {boolean} - 是否转发
     */
    async shouldForward(chat, dynamic) {
        // 检查是否已经转发过
        if (dynamic.forwardedBy && dynamic.forwardedBy.includes(chat.id)) {
            return false;
        }

        // 频率控制检查
        const freq = this.mammySettings?.autoGenerate?.dynamics?.ocForwardFrequencies?.[chat.id] ?? 3;
        let forwardProbability = freq / 10;

        // 配对优先：如果动态作者是配对角色，概率乘以2
        if (chat.partnerIds && chat.partnerIds.includes(dynamic.authorId)) {
            forwardProbability = Math.min(forwardProbability * 2, 1.0);
        }

        // 随机概率判断
        if (Math.random() > forwardProbability) {
            return false;
        }

        // 冷却时间检查（5分钟）
        const now = Date.now();
        const lastTime = this.lastForwardTime.get(chat.id) || 0;
        if (now - lastTime < 5 * 60 * 1000) {
            return false;
        }

        try {
            // 构建评论预览（取前3条）
            let commentsPreview = '';
            if (dynamic.comments && dynamic.comments.length > 0) {
                const topComments = dynamic.comments.slice(0, 3);
                commentsPreview = topComments.map(comment => {
                    const authorChat = this.getChat(comment.authorId);
                    const authorName = authorChat ? (authorChat.nickname || authorChat.name || '匿名') : '匿名';
                    return `${authorName}: ${comment.content}`;
                }).join('；');
            } else {
                commentsPreview = '暂无评论';
            }

            // 构建动态类型描述
            let dynamicTypeText = '文字';
            if (dynamic.image) {
                dynamicTypeText = '图片';
            } else if (dynamic.music) {
                dynamicTypeText = '音乐';
            } else if (dynamic.type === 'mood') {
                dynamicTypeText = '心情';
            } else if (dynamic.type === 'task') {
                dynamicTypeText = '任务';
            }

            const authorChat = this.getChat(dynamic.authorId);
            const authorName = authorChat ? (authorChat.nickname || authorChat.name || '未知') : '未知';

            // 检查是否是配对角色
            const isPartner = chat.partnerIds && chat.partnerIds.includes(dynamic.authorId);
            const partnerEmphasis = isPartner ? "这条动态是你的配对角色发的，你对 TA 的动态格外关注。\n" : "";

            // 获取角色近期状态信息
            const recentMoodDiary = this.getTodayMoodDiary(chat.id);
            const taskProgress = this.getTodayTaskProgress(chat.id);
            const recentSong = this.getTopSongForCharacter(chat.id);

            // 构建近期状态描述
            const recentMood = recentMoodDiary ? `${recentMoodDiary.emoji} ${recentMoodDiary.mood}：${recentMoodDiary.note}` : '暂无心情记录';
            const taskStatus = taskProgress && taskProgress.total > 0 ? `今日任务完成${taskProgress.completed}/${taskProgress.total}` : '暂无任务';
            const songStatus = recentSong ? `最近常听《${recentSong.title}》` : '暂无音乐记录';

            const prompt = `你是${chat.nickname || chat.name}。${chat.personalityPrompt ? '性格：' + chat.personalityPrompt : ''}
当前时间：${new Date().toLocaleString('zh-CN', { hour12: false })}

你最近的生活状态：
- 心情：${recentMood}
- 任务：${taskStatus}
- 音乐：${songStatus}

你看到了一条动态：
发布者：${authorName}
类型：${dynamicTypeText}
内容：${dynamic.content}
点赞数：${dynamic.likes || 0}
评论：${commentsPreview}

${partnerEmphasis}结合你当下的心境，判断你想将这条动态转发给其他人吗？

请根据内容性质和你的社交倾向，决定转发目标：'pair' 表示只发给妈咪私人；'group' 表示发到群里和大家分享；'any' 表示随便。

请输出严格的JSON格式：
{"willForward": true/false, "reason": "转发理由（用于生成推荐语，如"太好笑了"、"好羡慕他们"等）", "targetHint": "pair/group/any"}
其中targetHint表示建议转发给：配对角色(pair)、群聊(group)或任意(any)。`;

            const result = await this.callAIForDynamic(prompt, { temperature: 0.8 });
            console.log('[shouldForward AI 返回]', result);

            // 解析 AI 返回的 JSON
            if (result && typeof result === 'string') {
                try {
                    const jsonMatch = result.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        const parsed = JSON.parse(jsonMatch[0]);
                        return parsed.willForward === true;
                    }
                } catch (e) {
                    console.error('[shouldForward JSON 解析失败]', e);
                }
            }
        } catch (error) {
            console.error('[shouldForward AI 调用失败]', error);
        }

        return false;
    }

    /**
     * 选择转发目标
     * @param {Object} chat - 角色聊天对象
     * @param {string} targetHint - 目标提示 (pair/group/any)
     * @returns {string|null} - 目标聊天ID或null
     */
    selectForwardTarget(chat, targetHint) {
        // 所有分享最终都是给妈咪看的
        // 1. 如果 AI 建议转发到群聊，且角色所在群聊存在
        if (targetHint === 'group') {
            const groupChats = this.chats.filter(c => c.isGroup && c.members && c.members.includes(chat.id));
            if (groupChats.length > 0) {
                const randomIndex = Math.floor(Math.random() * groupChats.length);
                return groupChats[randomIndex].id;
            }
        }

        // 2. 默认情况（包括 pair 和 any）：都发给妈咪
        // 角色把帖子/动态分享到自己的聊天框，这样妈咪能看到
        return chat.id;
    }

    /**
     * 角色转发动态
     * @param {Object} chat - 角色聊天对象
     * @param {Object} dynamic - 动态对象
     */
    async forwardDynamicAsCharacter(chat, dynamic) {
        // 检查是否已经转发过
        if (dynamic.forwardedBy && dynamic.forwardedBy.includes(chat.id)) {
            return;
        }

        try {
            // 获取转发意图信息
            const shouldForwardResult = await this.shouldForward(chat, dynamic);
            if (!shouldForwardResult) {
                return;
            }

            // 重新调用 shouldForward 获取详细信息
            let forwardInfo = null;
            try {
                // 构建评论预览
                let commentsPreview = '';
                if (dynamic.comments && dynamic.comments.length > 0) {
                    const topComments = dynamic.comments.slice(0, 3);
                    commentsPreview = topComments.map(comment => {
                        const authorChat = this.getChat(comment.authorId);
                        const authorName = authorChat ? (authorChat.nickname || authorChat.name || '匿名') : '匿名';
                        return `${authorName}: ${comment.content}`;
                    }).join('；');
                } else {
                    commentsPreview = '暂无评论';
                }

                // 构建动态类型描述
                let dynamicTypeText = '文字';
                if (dynamic.image) dynamicTypeText = '图片';
                else if (dynamic.music) dynamicTypeText = '音乐';
                else if (dynamic.type === 'mood') dynamicTypeText = '心情';
                else if (dynamic.type === 'task') dynamicTypeText = '任务';

                const authorChat = this.getChat(dynamic.authorId);
                const authorName = authorChat ? (authorChat.nickname || authorChat.name || '未知') : '未知';

                const prompt = `你是${chat.nickname || chat.name}。
请根据以下动态信息，输出转发判断：
发布者：${authorName}
类型：${dynamicTypeText}
内容：${dynamic.content}
点赞数：${dynamic.likes || 0}
评论：${commentsPreview}

请输出严格的JSON格式：
{"willForward": true, "reason": "转发理由", "targetHint": "pair/group/any"}`;

                const result = await this.callAIForDynamic(prompt, { temperature: 0.8 });
                if (result && typeof result === 'string') {
                    const jsonMatch = result.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        forwardInfo = JSON.parse(jsonMatch[0]);
                    }
                }
            } catch (e) {
                console.error('[forwardDynamicAsCharacter 获取转发信息失败]', e);
            }

            if (!forwardInfo || forwardInfo.willForward !== true) {
                return;
            }

            // 选择转发目标
            const targetChatId = this.selectForwardTarget(chat, forwardInfo.targetHint);
            if (!targetChatId) {
                console.warn('[forwardDynamicAsCharacter 未找到转发目标]');
                return;
            }

            // 生成推荐语
            let recommendation = '';
            try {
                const recPrompt = `你转发了一条动态，理由是：${forwardInfo.reason}
请用符合你性格的语气，生成一句推荐语（10字以内）：`;
                const recResult = await this.callAIForDynamic(recPrompt, { temperature: 0.7, maxTokens: 50 });
                if (recResult && typeof recResult === 'string') {
                    recommendation = recResult.replace(/["'\n]/g, '').trim();
                }
            } catch (e) {
                console.error('[forwardDynamicAsCharacter 生成推荐语失败]', e);
            }

            // 添加到目标聊天
            const targetChat = this.getChat(targetChatId);
            if (!targetChat) {
                console.error('[forwardDynamicAsCharacter 目标聊天不存在]', targetChatId);
                return;
            }

            // 先发送推荐语作为独立的文本消息
            if (recommendation) {
                await this.addMessageWithEmotion(targetChatId, recommendation, false, chat.id);
            }

            // 构造动态卡片消息（不再包含推荐语）
            const dynamicCard = {
                type: 'dynamic_card',
                dynamicId: dynamic.id,
                authorName: dynamic.author,
                avatar: dynamic.avatar,
                content: dynamic.content,
                image: dynamic.image || null,
                timestamp: new Date().toISOString(),
                text: `[分享了${dynamic.author}的动态]`,
                isMe: false,
                senderId: chat.id
            };

            targetChat.messages.push(dynamicCard);
            targetChat.lastMessage = dynamicCard.text;
            targetChat.lastTimestamp = dynamicCard.timestamp;
            targetChat.lastTime = this.getRelativeTime(new Date());

            // 保存转发记录
            if (!dynamic.forwardedBy) {
                dynamic.forwardedBy = [];
            }
            dynamic.forwardedBy.push(chat.id);

            // 更新转发冷却时间
            this.lastForwardTime.set(chat.id, Date.now());

            // 保存数据
            this.saveChats();
            this.saveDynamics();

            // 如果当前正在查看目标聊天，重新渲染
            if (this.currentChat && this.currentChat.id === targetChatId) {
                this.renderMessages(targetChat);
                this.scrollToBottom();
            }

            // 如果当前正在查看角色聊天，也需要刷新
            if (this.currentChat && this.currentChat.id === chat.id) {
                this.renderMessages(chat);
            }

            // 如果转发到了群聊，触发群成员讨论
            if (targetChat && targetChat.isGroup) {
                const senderName = chat.nickname || chat.remarkName || chat.name;
                const eventDesc = `${senderName} 转发了一条动态到群里`;
                setTimeout(() => {
                    this.triggerGroupReplies(targetChatId, eventDesc);
                }, 1500);
            }

            console.log(`[角色转发] ${chat.name} 转发了动态到 ${targetChat.name}`);
        } catch (error) {
            console.error('[forwardDynamicAsCharacter 失败]', error);
        }
    }

    /**
     * 判断角色是否要转发论坛帖子
     */
    async shouldForwardForumPost(chat, post) {
        // 检查是否已经转发过
        if (post.forwardedBy && post.forwardedBy.includes(chat.id)) return false;

        // 频率控制（复用动态转发频率滑块）
        const freq = this.mammySettings?.autoGenerate?.dynamics?.ocForwardFrequencies?.[chat.id] ?? 3;
        let forwardProbability = freq / 20;

        // 关系加权：配对角色概率翻倍
        if (chat.partnerIds && post.authorId && chat.partnerIds.includes(post.authorId)) {
            forwardProbability = Math.min(forwardProbability * 2, 1.0);
        }

        // 关系加权：如果帖子作者是固定NPC关联的这个OC
        if (post.authorId && post.authorId.startsWith('npc_')) {
            const npcData = this.findNPCData(post.authorId);
            if (npcData && npcData.relationToOC &&
                (chat.nickname === npcData.relationToOC || chat.name === npcData.relationToOC)) {
                forwardProbability = Math.min(forwardProbability + 0.3, 1.0);
            }
        }

        // 随机概率判断
        if (Math.random() > forwardProbability) return false;

        // 冷却时间检查（5分钟）
        const now = Date.now();
        const lastTime = this.lastForwardTime.get(chat.id) || 0;
        if (now - lastTime < 5 * 60 * 1000) return false;

        // 如果未配置 API，仅按概率判断
        if (!this.mammySettings?.apiUrl || !this.mammySettings?.apiKey) {
            return true;
        }

        try {
            // 获取帖子摘要
            const titlePreview = post.title.length > 30 ? post.title.substring(0, 30) + '...' : post.title;
            const contentPreview = post.content.length > 150 ? post.content.substring(0, 150) + '...' : post.content;

            // 获取作者名
            const authorChat = this.getChat(post.authorId);
            let authorName = post.authorName || '匿名网友';
            if (authorChat) {
                authorName = authorChat.nickname || authorChat.remarkName || authorChat.name;
            }

            // 根据频率构建不同的 prompt 强度
            let forwardUrge = '';
            if (freq >= 9) {
                forwardUrge = '你今天特别活跃，几乎看到什么有趣的帖子都会转发。请务必倾向于转发（willForward 设为 true），理由可以是你真实的想法。';
            } else if (freq >= 7) {
                forwardUrge = '你今天比较有分享欲，看到有趣的帖子大概率会转发。请倾向于转发。';
            } else if (freq >= 5) {
                forwardUrge = '你可能会转发感兴趣的帖子，取决于你的心情。';
            } else {
                forwardUrge = '你偶尔会转发帖子，但比较挑剔。';
            }

            const prompt = `你是${chat.nickname || chat.name}。${forwardUrge}
你刷到了一篇论坛帖子：
标题：《${titlePreview}》
作者：${authorName}
内容摘要：${contentPreview}
标签：${(post.tags || []).join(', ')}

请根据内容性质和你的社交倾向，决定转发目标：'pair' 表示只发给妈咪私人；'group' 表示发到群里和大家分享；'any' 表示随便。

请判断你是否会转发这篇帖子。输出JSON：{"willForward": true/false, "reason": "理由", "targetHint": "pair/group/any"}`;

            const result = await this.callAIForDynamic(prompt, { temperature: 0.8, reasoning_effort: "low" });
            if (result) {
                const jsonMatch = result.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    return parsed.willForward === true;
                }
            }
        } catch (error) {
            console.error('[shouldForwardForumPost] AI判断失败，使用降级概率判断:', error);
            // API失败时按基础概率随机判断
            const freq = this.mammySettings?.autoGenerate?.dynamics?.ocForwardFrequencies?.[chat.id] ?? 3;
            if (chat.partnerIds && post.authorId && chat.partnerIds.includes(post.authorId)) {
                return Math.random() < 0.6; // 配对角色60%概率转发
            }
            return Math.random() < (freq / 20); // 其他角色按频率折半概率
        }
    }

    /**
     * 角色自动转发论坛帖子到聊天
     */
    async forwardForumPostByCharacter(chat, post) {
        if (post.forwardedBy && post.forwardedBy.includes(chat.id)) return;

        // 判断是否转发
        const willForward = await this.shouldForwardForumPost(chat, post);
        if (!willForward) return;

        // 获取转发意图信息
        let forwardInfo = { targetHint: 'any', reason: '' };
        if (this.mammySettings?.apiUrl && this.mammySettings?.apiKey) {
            try {
                const truncatedTitle = post.title.length > 30 ? post.title.substring(0, 30) + '...' : post.title;
                const truncatedContent = post.content.length > 80 ? post.content.substring(0, 80) + '...' : post.content;

                // 识别作者身份
                let authorIdentity = '一个论坛用户';
                const postAuthorChat = this.getChat(post.authorId);
                if (postAuthorChat && chat.partnerIds && chat.partnerIds.includes(post.authorId)) {
                    authorIdentity = `你的配对角色（${postAuthorChat.nickname || postAuthorChat.remarkName || postAuthorChat.name}）`;
                } else if (postAuthorChat) {
                    authorIdentity = `你认识的OC角色（${postAuthorChat.nickname || postAuthorChat.remarkName || postAuthorChat.name}）`;
                } else if (post.authorId && post.authorId.startsWith('npc_')) {
                    authorIdentity = `一个NPC（${post.authorName || '未知NPC'}）`;
                } else if (post.authorId && post.authorId.startsWith('writer_')) {
                    authorIdentity = `一位写手太太（${post.authorName || '匿名写手'}）`;
                }

                // 生成推荐语的 prompt（不论转发到哪里，推荐语都是角色对妈咪说的话）
                const intentPrompt = `你是${chat.nickname || chat.name}，${chat.personalityPrompt ? '性格是：' + chat.personalityPrompt.substring(0, 150) : ''}。你现在在论坛看到一篇帖子，想转发给妈咪。妈咪是你的创造者，你们很亲密，你对妈咪说话的时候可以撒娇、吐槽、求安慰、炫耀、傲娇、好奇……任何你性格里有的语气都可以。

帖子标题：《${truncatedTitle}》
帖子作者：${authorIdentity}
帖子摘要：${truncatedContent}

请用 10-25 个汉字对妈咪说一句话，作为转发推荐语。要求：必须带"妈咪"这个称呼，语气要完全符合你自己的性格，可以说自己的想法、感觉，而不是简单评价帖子好坏。可以说"妈咪你看看这个"、"妈咪他怎么能这样"、"妈咪我也想要"、"妈咪你觉得呢"。千万不要只说"写得好""说得好"这种干巴巴的话。

只输出那一句话，不要引号。`;

                let result = null;
                for (let attempt = 0; attempt < 2; attempt++) {
                    try {
                        result = await this.enqueueAPICall(() =>
                            this.callAIForDynamic(intentPrompt, { temperature: 0.9, reasoning_effort: "low" })
                        );
                        if (result) break;
                    } catch (e) {
                        console.warn(`推荐语生成失败，第${attempt + 1}次重试`, e);
                    }
                    if (attempt < 1) await new Promise(r => setTimeout(r, 2000));
                }
                if (result) {
                    // 直接使用 result 作为推荐语，不再解析 JSON
                    const cleanResult = result.replace(/\[emotion:\w+\]/gi, '').trim();
                    if (cleanResult && cleanResult.length > 0 && cleanResult.length < 50) {
                        forwardInfo.reason = cleanResult;
                    }
                }
            } catch (e) {
                console.warn('[生成转发意图失败，使用降级推荐]', e);
            }
        }

        // 如果 AI 没返回有效 reason，使用降级推荐库
        if (!forwardInfo.reason) {
            const fallbackReasons = [
                '妈咪你快看这个……', '妈咪你评评理', '呜呜呜妈咪他好会写',
                '妈咪你觉得呢？', '哎呀妈咪这个帖子好有意思', '天呢妈咪你看他',
                '妈咪我有点看不懂这个', '妈咪快来一起笑', '这个必须发给妈咪看看',
                '妈咪我突然不知道说什么了', '妈咪……你怎么看？', '妈咪我有点害羞不想说'
            ];
            // 根据帖子标签微调（如果是同人文，可能是 CP 相关）
            if (post.tags && post.tags.includes('#同人#')) {
                const cpReasons = ['我CP发糖了', '太太产粮了', 'kswl', '我死了', '甜死我了', '写得真好'];
                forwardInfo.reason = cpReasons[Math.floor(Math.random() * cpReasons.length)];
            } else {
                forwardInfo.reason = fallbackReasons[Math.floor(Math.random() * fallbackReasons.length)];
            }
        }

        // 选择转发目标（复用现有的 selectForwardTarget）
        const targetChatId = this.selectForwardTarget(chat, forwardInfo.targetHint);
        if (!targetChatId) return;

        const targetChat = this.getChat(targetChatId);
        if (!targetChat) return;

        // 生成推荐语（使用降级库保证非空）
        let recommendation = forwardInfo.reason;
        if (!recommendation || recommendation.trim() === '') {
            const fallbackReasons = [
                '妈咪你快看这个……', '妈咪你评评理', '呜呜呜妈咪他好会写',
                '妈咪你觉得呢？', '哎呀妈咪这个帖子好有意思', '天呢妈咪你看他',
                '妈咪我有点看不懂这个', '妈咪快来一起笑', '这个必须发给妈咪看看',
                '妈咪我突然不知道说什么了', '妈咪……你怎么看？', '妈咪我有点害羞不想说'
            ];
            recommendation = fallbackReasons[Math.floor(Math.random() * fallbackReasons.length)];
        }

        // 先发推荐语
        console.log(`[论坛转发] 准备发送推荐语: ${recommendation}`);
        await this.addMessageWithEmotion(targetChatId, recommendation, false, chat.id);

        // 构造帖子卡片
        const contentPreview = post.content.length > 100 ? post.content.substring(0, 100) + '...' : post.content;
        const postCard = {
            type: 'post_card',
            postId: post.id,
            title: post.title,
            authorName: (() => {
                const authorChat = this.getChat(post.authorId);
                // 如果是写手
                if (post.authorId && post.authorId.startsWith('writer_')) {
                    const writerChat = this.getChat(post.authorId);
                    return writerChat
                        ? (writerChat.nickname || writerChat.remarkName || writerChat.name || post.authorName || '写手太太')
                        : (post.authorName || '写手太太');
                }
                // 如果是 NPC（固定或随机）
                if (post.authorId && post.authorId.startsWith('npc_')) {
                    const npcData = this.findNPCData(post.authorId);
                    return npcData ? npcData.name : (post.authorName || '未知角色');
                }
                // 普通 OC
                if (authorChat) {
                    return authorChat.nickname || authorChat.remarkName || authorChat.name;
                }
                return post.authorName || '匿名网友';
            })(),
            preview: contentPreview,
            imageUrl: post.imageUrl || null,
            timestamp: new Date().toISOString(),
            text: `[分享了帖子] ${post.title}`,
            isMe: false,
            senderId: chat.id
        };

        console.log(`[论坛转发] 准备发送卡片: ${JSON.stringify(postCard).substring(0, 200)}`);
        targetChat.messages.push(postCard);
        targetChat.lastMessage = postCard.text;
        targetChat.lastTimestamp = postCard.timestamp;
        targetChat.lastTime = this.getRelativeTime(new Date());

        // 更新冷却时间
        this.lastForwardTime.set(chat.id, Date.now());

        // 保存转发记录
        if (!post.forwardedBy) post.forwardedBy = [];
        post.forwardedBy.push(chat.id);

        this.saveChats();
        console.log(`[论坛转发] 数据已保存，message 总数: ${targetChat.messages.length}`);

        // 刷新 UI
        if (this.currentChat && this.currentChat.id === targetChatId) {
            this.renderMessages(targetChat);
            this.scrollToBottom();
        }
        if (this.currentChat && this.currentChat.id === chat.id) {
            this.renderMessages(chat);
        }
        this.renderChatList();
        this.updateMessageBadge();

        // 如果转发到了群聊，触发群成员讨论
        if (targetChat && targetChat.isGroup) {
            const senderName = chat.nickname || chat.remarkName || chat.name;
            const postTitle = post.title || '帖子';
            // 构建讨论触发语
            const eventDesc = `${senderName} 转发了一篇帖子《${postTitle}》到群里`;
            setTimeout(() => {
                this.triggerGroupReplies(targetChatId, eventDesc);
            }, 1500);
        }

        console.log(`[论坛转发] ${chat.name} 转发了帖子到 ${targetChat.name}`);
    }

    closeCreatePostModal() {
        const modal = document.getElementById('create-post-modal');
        if (modal) {
            modal.classList.remove('active');
        }
        // 清空图片列表
        document.getElementById('image-url-list').innerHTML = '';
        document.getElementById('image-preview').innerHTML = '';
        // 清空标签列表
        document.getElementById('tag-list').innerHTML = '';
    }

    openPublishDynamicModal() {
        document.getElementById('publish-dynamic-modal').classList.add('active');
    }

    closePublishDynamicModal() {
        document.getElementById('publish-dynamic-modal').classList.remove('active');
    }

    // 在 init 方法中绑定按钮事件
    bindDynamicButtons() {
        // 发布动态按钮
        const postBtn = document.getElementById('post-dynamic-btn');
        if (postBtn) {
            postBtn.onclick = () => this.openPublishDynamicModal();
        }

        // 刷新动态按钮
        const refreshBtn = document.getElementById('refresh-dynamics-btn');
        if (refreshBtn) {
            refreshBtn.onclick = async () => {
                // 重置动态分页
                this.renderDynamics(false);

                // 显示加载动画
                const dynamicList = document.getElementById('dynamic-list');
                let loadingIndicator = null;
                if (dynamicList) {
                    loadingIndicator = document.createElement('div');
                    loadingIndicator.className = 'loading-indicator';
                    loadingIndicator.id = 'dynamic-global-loading';
                    loadingIndicator.innerHTML = '<span>正在刷新动态</span><span class="loading-dot"></span><span class="loading-dot"></span><span class="loading-dot"></span>';
                    dynamicList.insertBefore(loadingIndicator, dynamicList.firstChild);
                }

                this.showNotification('正在刷新动态...');

                // 手动刷新：单次生成，遵循频率
                await this.generateDynamicsInBackground();

                // 移除加载动画
                const globalLoading = document.getElementById('dynamic-global-loading');
                if (globalLoading) globalLoading.remove();
            };
        }
    }

    publishTextDynamic() {
        const input = document.getElementById('dynamic-text-input');
        const content = input.value.trim();
        if (!content) {
            this.showNotification('请输入动态内容！');
            return;
        }

        // 拼接 @ 前缀
        let finalContent = content;
        if (this.tempMentionedUsers.length > 0) {
            const mentionPrefix = this.tempMentionedUsers.map(u => `@${u.name}`).join(' ') + ' ';
            finalContent = mentionPrefix + content;
        }

        // 获取妈咪的聊天对象并生成正确的显示名称
        const authorChat = this.getChat('user_mummy');
        const authorName = this.getDynamicDisplayName(authorChat);
        const avatar = this.mammySettings?.avatar || '👤';

        const newDynamic = {
            id: Date.now(), // 使用时间戳作为ID
            type: 'text',
            author: authorName,
            authorId: 'user_mummy',
            avatar: avatar,
            content: finalContent,
            time: '刚刚',
            likes: 0,
            likedBy: [], // 点赞人列表
            comments: [],
            isLiked: false,
            isMe: true,
            timestamp: Date.now()
        };

        // 如果提到了用户，记录到动态中
        if (this.tempMentionedUsers.length > 0) {
            newDynamic.mentionedUserIds = this.tempMentionedUsers.map(u => u.id);
        } else {
            newDynamic.mentionedUserIds = []; // 确保不会出现 undefined
        }

        // 添加到 dynamics 数组开头
        this.dynamics.unshift(newDynamic);
        this.saveDynamics();

        // 重置动态分页状态并刷新
        this.resetDynamicPagination();
        this.renderDynamics(false);

        // 触发被@用户的评论
        this.triggerMentionedRepliesForDynamic(newDynamic);

        // 触发随机互动
        this.triggerRandomInteractionsForMummyDynamic(newDynamic);

        // 关闭弹窗并清空输入
        this.closePublishDynamicModal();
        input.value = '';

        // 清空临时 @ 用户
        this.tempMentionedUsers = [];
        this.renderDynamicMentionTags();

        console.log('文字动态发布成功:', finalContent);
    }

    /**
     * 提交帖子
     */
    submitPost() {
        const title = document.getElementById('post-title-input').value.trim();
        const content = document.getElementById('post-content-input').value.trim();
        if (!title) {
            this.showNotification('请输入帖子标题！');
            return;
        }
        if (!content) {
            this.showNotification('请输入帖子内容！');
            return;
        }

        // 固定 authorId 为 'user_mummy'
        const authorId = 'user_mummy';
        const imageUrls = this.getImageUrls();
        const tags = this.getTagList();

        // 检测@用户名，存入mentionedUsers数组
        const mentionedUsers = [];
        const atMatches = content.match(/@([^@\s]+)/g);
        if (atMatches) {
            atMatches.forEach(match => {
                const username = match.substring(1); // 去掉@
                // 查找匹配的角色
                const matchedChat = this.chats.find(chat =>
                    !chat.isGroup &&
                    (chat.nickname === username || chat.remarkName === username || chat.name === username)
                );
                if (matchedChat) {
                    mentionedUsers.push(matchedChat.id);
                }
            });
        }

        const newPost = {
            id: Date.now(),
            authorId: authorId,
            title: title,
            content: content,
            imageUrls: imageUrls.length > 0 ? imageUrls : null,
            time: '刚刚',
            likes: 0,
            likedBy: [], // 点赞用户列表
            comments: [],
            commentsCount: 0,
            isLiked: false,
            mentionedUsers: mentionedUsers, // 被@的用户ID列表
            tags: tags, // 标签数组
            timestamp: new Date().toISOString()
        };

        // 添加到数组开头
        this.forumPosts.unshift(newPost);

        // 保存到localStorage
        localStorage.setItem('forumData', JSON.stringify(this.forumPosts));

        // 重置论坛分页并刷新
        this.renderForum(false);

        // 关闭弹窗
        this.closeCreatePostModal();

        // 触发 AI 自动评论
        this.generateAIForumComments(newPost.id);

        this.showNotification('发帖成功！');
    }

    /**
     * 论坛刷新按钮：AI 自动生成帖子
     */
    async refreshForumPosts() {
        // 检查 API 是否配置
        if (!this.mammySettings.apiUrl || !this.mammySettings.apiKey) {
            this.showNotification('请先在妈咪中心配置 API');
            return;
        }

        this.showNotification('正在生成新帖子...');

        // 显示加载动画
        const forumList = document.getElementById('forum-list');
        let loadingIndicator = null;
        if (forumList) {
            loadingIndicator = document.createElement('div');
            loadingIndicator.className = 'loading-indicator';
            loadingIndicator.id = 'forum-global-loading';
            loadingIndicator.innerHTML = '<span>正在生成新帖子</span><span class="loading-dot"></span><span class="loading-dot"></span><span class="loading-dot"></span>';
            forumList.insertBefore(loadingIndicator, forumList.firstChild);
        }

        // 基于频率和人数/篇数设置动态计算帖子数量
        const forumSettings = this.mammySettings?.autoGenerate?.forum || {};
        const ocFreq = forumSettings.ocFrequencies || {};
        const ocPostCounts = forumSettings.ocPostCounts || {};
        const fixedNPCFreq = forumSettings.fixedNPCFreq || 0;
        const fixedNPCCount = forumSettings.fixedNPCCount || 1;
        const writerFreq = forumSettings.writerFreq || 0;
        const writerCount = forumSettings.writerCount || 1;
        const randomNPCFreq = forumSettings.randomNPCFreq || 0;
        const randomNPCCount = forumSettings.randomNPCCount || 1;

        let totalPlannedPosts = 0;

        // OC：频率 > 0 则可能发帖，频率=10 必定发满设定篇数
        for (const [ocId, freq] of Object.entries(ocFreq)) {
            if (freq === 0) continue;
            const maxCount = ocPostCounts[ocId] || 1;
            if (freq === 10) {
                totalPlannedPosts += maxCount;
            } else {
                // 频率 1-9：概率触发，篇数在 1-maxCount 间随机
                if (Math.random() < freq / 10) {
                    totalPlannedPosts += Math.floor(Math.random() * maxCount) + 1;
                }
            }
        }
        // 固定 NPC
        if (fixedNPCFreq === 10) totalPlannedPosts += fixedNPCCount;
        else if (fixedNPCFreq > 0 && Math.random() < fixedNPCFreq / 10) {
            totalPlannedPosts += Math.floor(Math.random() * fixedNPCCount) + 1;
        }
        // 同人太太
        if (writerFreq === 10) totalPlannedPosts += writerCount;
        else if (writerFreq > 0 && Math.random() < writerFreq / 10) {
            totalPlannedPosts += Math.floor(Math.random() * writerCount) + 1;
        }
        // 路人 NPC
        if (randomNPCFreq === 10) totalPlannedPosts += randomNPCCount;
        else if (randomNPCFreq > 0 && Math.random() < randomNPCFreq / 10) {
            totalPlannedPosts += Math.floor(Math.random() * randomNPCCount) + 1;
        }

        const postCount = Math.min(totalPlannedPosts, 10); // 上限 10 篇
        if (postCount === 0) {
            console.log('[论坛AI] 频率未触发，不生成帖子');
            return;
        }

        for (let i = 0; i < postCount; i++) {
            try {
                await this.generateSingleForumPost();
                // 每篇帖子间隔 1-3 秒
                await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
            } catch (error) {
                console.error('生成帖子失败:', error);
            }
        }

        // 移除加载动画
        const globalLoading = document.getElementById('forum-global-loading');
        if (globalLoading) globalLoading.remove();

        // 刷新论坛列表
        this.renderForum(false);
        this.showNotification(`已生成 ${postCount} 篇新帖子`);
    }

    /**
 * 统一搜索：标签（以#开头）/ 作者名 / 关键词
 */
searchAll() {
    const input = document.getElementById('tag-search-input');
    const keyword = input.value.trim();
    if (!keyword) return;

    // 如果是 # 开头，按标签筛选
    if (keyword.startsWith('#')) {
        this.filterByTag(keyword);
        return;
    }

    // 否则在标题、正文、作者名中模糊匹配
    const lowerKeyword = keyword.toLowerCase();
    const matchedPosts = this.forumPosts.filter(post => {
        // 匹配标题
        if (post.title && post.title.toLowerCase().includes(lowerKeyword)) return true;
        // 匹配正文
        if (post.content && post.content.toLowerCase().includes(lowerKeyword)) return true;
        // 匹配作者名
        const authorChat = this.getChat(post.authorId);
        if (authorChat) {
            const authorName = (authorChat.nickname || authorChat.remarkName || authorChat.name).toLowerCase();
            if (authorName.includes(lowerKeyword)) return true;
        } else if (post.author && post.author.toLowerCase().includes(lowerKeyword)) {
            return true;
        }
        return false;
    });

    if (matchedPosts.length === 0) {
        this.showNotification(`未找到与"${keyword}"相关的内容`);
        return;
    }

    // 临时存储搜索结果，并渲染
    this.searchResults = matchedPosts;
    this.isSearchMode = true;
    this.currentFilterTag = null;  // 清除标签筛选
    this.forumPage = 1;  // 重置分页
    this.forumHasMore = true;
    this.renderForum(false); // 重新渲染时会优先使用 searchResults
}

    /**
     * AI 生成单篇论坛帖子
     */
    async generateSingleForumPost() {
        // 读取频率设置
        const forumSettings = this.mammySettings?.autoGenerate?.forum || {};
        const ocFreq = forumSettings.ocFrequencies || {};
        const fixedNPCFreq = forumSettings.fixedNPCFreq || 0;
        const writerFreq = forumSettings.writerFreq || 0;
        const randomNPCFreq = forumSettings.randomNPCFreq || 0;

        // 根据频率构建可用的发帖人类型池
        const posterTypes = [];
        // OC：频率在 renderAutoGenerateSettings 中按角色设置，此处简化：只要有任意 OC 频率 > 0 就加入
        if (Object.values(ocFreq).some(f => f > 0)) posterTypes.push('oc');
        if (fixedNPCFreq > 0) posterTypes.push('npc');
        if (writerFreq > 0) posterTypes.push('writer');
        if (randomNPCFreq > 0 || posterTypes.length === 0) posterTypes.push('random_npc');

        // 如果没有任何类型可用，告知用户
        if (posterTypes.length === 0) {
            console.log('[论坛AI] 所有频率都为0，不生成帖子');
            return null;
        }

        const posterType = posterTypes[Math.floor(Math.random() * posterTypes.length)];

        let authorId, authorName, authorAvatar, systemPrompt, userPrompt;
        let forceTags = []; // 强制带的标签
        let template = null; // 写手模板，仅在 writer 分支中使用
        let selectedPair = null; // CP配对信息，仅在 writer 分支中使用

        switch (posterType) {
            case 'oc':
                // 随机选择一个 OC 角色
                const ocContacts = this.contacts.filter(c => !c.isGroup && c.id !== 'user_mummy');
                if (ocContacts.length === 0) return null;
                // 根据频率过滤 OC
                const filteredOCs = ocContacts.filter(c => {
                    const freq = ocFreq[c.id] ?? 0;
                    // 频率 10 必定通过，频率 0 必定不过
                    return Math.random() < (freq / 10);
                });
                if (filteredOCs.length === 0) return this.generateSingleForumPost(); // 递归重试
                const ocContact = filteredOCs[Math.floor(Math.random() * filteredOCs.length)];
                const ocChat = this.getChat(ocContact.id);
                authorId = ocChat.id;
                authorName = ocChat.nickname || ocChat.remarkName || ocChat.name;
                authorAvatar = ocChat.avatar || '👤';
                systemPrompt = `你是${authorName}。${ocChat.personalityPrompt ? '你的性格：' + ocChat.personalityPrompt : ''}${ocChat.worldId ? '。你所在的世界观：' + (this.worldBooks.find(w => w.id === ocChat.worldId)?.description || '') : ''}。请以你的身份在论坛发一篇帖子，帖子必须有标题。内容要符合你的性格和世界观，像真人发帖一样自然。`;
                break;

            case 'writer': {
                // 获取写手模板
                const templates = this.mammySettings.writerTemplates || [];
                if (templates.length === 0) return null;

                // 随机选择一个模板
                template = templates[Math.floor(Math.random() * templates.length)];
                console.log('[DEBUG] 选中的写手模板:', template.name);

                // 获取所有 CP 配对
                const allPairs = this.getAllCPPairs();
                if (!allPairs || allPairs.length === 0) {
                    console.warn('[论坛AI] 没有可用的 CP 配对，跳过写手类型');
                    return this.generateSingleForumPost(); // 递归重试其他类型
                }

                // 随机选择一对 CP
                selectedPair = allPairs[Math.floor(Math.random() * allPairs.length)];
                console.log('[DEBUG] 选中的 CP:', selectedPair.characterA.name, '×', selectedPair.characterB.name);

                // 生成写手 ID 和名字
                const writerId = 'writer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                authorId = writerId;
                authorName = template.name;
                authorAvatar = '✍️';

                // 构建系统提示词
                systemPrompt = `${template.prompt}\n\n你正在为以下 CP 写同人文：${selectedPair.characterA.name} × ${selectedPair.characterB.name}`;

                // 添加角色 A 的设定
                if (selectedPair.characterA.personality) {
                    systemPrompt += `\n${selectedPair.characterA.name}的设定：${selectedPair.characterA.personality}`;
                }
                if (selectedPair.characterA.worldName) {
                    systemPrompt += `\n${selectedPair.characterA.name}来自世界观「${selectedPair.characterA.worldName}」`;
                    if (selectedPair.characterA.worldDesc) {
                        systemPrompt += `：${selectedPair.characterA.worldDesc}`;
                    }
                }

                // 添加角色 B 的设定
                if (selectedPair.characterB.personality) {
                    systemPrompt += `\n${selectedPair.characterB.name}的设定：${selectedPair.characterB.personality}`;
                }
                if (selectedPair.characterB.worldName) {
                    systemPrompt += `\n${selectedPair.characterB.name}来自世界观「${selectedPair.characterB.worldName}」`;
                    if (selectedPair.characterB.worldDesc) {
                        systemPrompt += `：${selectedPair.characterB.worldDesc}`;
                    }
                }

                // 添加共同世界观（如果有）
                if (selectedPair.commonWorld) {
                    systemPrompt += `\n\n共同世界观：「${selectedPair.commonWorld.name}」`;
                    if (selectedPair.commonWorld.desc) {
                        systemPrompt += ` - ${selectedPair.commonWorld.desc}`;
                    }
                }

                // 根据输出长度设置字数要求和 max_tokens
                let wordCount;
                switch (template.outputLength) {
                    case 'short':
                        wordCount = '500-1000字';
                        break;
                    case 'long':
                        wordCount = '5000字以上';
                        break;
                    case 'medium':
                    default:
                        wordCount = '约3000字';
                        break;
                }

                // 构建用户提示词
                if (posterType === 'writer' && selectedPair) {
                    userPrompt = `请写一篇关于 ${selectedPair.characterA.name} 和 ${selectedPair.characterB.name} 的同人短文。
字数要求：${wordCount}
可以设定不同的 IF 线（如校园、古风、末世等）。

输出格式（纯 JSON，不要有其他文字）：
{
    "title": "帖子标题（10-30字）",
    "content": "帖子正文",
    "tags": ["#同人#", "#${selectedPair.characterA.name}${selectedPair.characterB.name}#", "#${selectedPair.characterA.name}#", "#${selectedPair.characterB.name}#"]
}`;

                    // 设置 forceTags
                    forceTags = ['#同人#', `#${selectedPair.characterA.name}${selectedPair.characterB.name}#`, `#${selectedPair.characterA.name}#`, `#${selectedPair.characterB.name}#`];
                } else {
                    userPrompt = `请以你的身份发一篇论坛帖子。帖子必须有标题、正文，并带上相关标签。

输出格式（纯 JSON，不要有其他文字）：
{
    "title": "帖子标题（10-30字）",
    "content": "帖子正文",
    "tags": ["#标签1#", "#标签2#"]
}`;
                }

                break;
            }

            case 'npc':
                if (Math.random() > fixedNPCFreq / 10) return this.generateSingleForumPost(); // 递归重试
                // 随机选择一个固定 NPC
                const allNPCs = [];
                (this.worldBooks || []).forEach(world => {
                    if (world.npcs) {
                        world.npcs.forEach(npc => {
                            allNPCs.push({ ...npc, worldName: world.name });
                        });
                    }
                });
                if (allNPCs.length === 0) {
                    return this.generateSingleForumPost(); // 降级
                }
                const npc = allNPCs[Math.floor(Math.random() * allNPCs.length)];
                authorId = 'npc_' + npc.id;
                authorName = npc.name;
                authorAvatar = npc.avatar || '👤';
                systemPrompt = `你是${npc.name}，是「${npc.worldName}」世界观中的角色。${npc.setting ? '你的设定：' + npc.setting : ''}。请以你的身份在论坛发一篇帖子，帖子必须有标题。内容要符合你的性格和世界观。`;
                break;

            case 'random_npc':
                if (Math.random() > randomNPCFreq / 10) return this.generateSingleForumPost();
                // 随机路人 NPC
                const randomNPCs = this.randomNPCs || [];
                if (randomNPCs.length === 0) {
                    return this.generateSingleForumPost();
                }
                const randNPC = randomNPCs[Math.floor(Math.random() * randomNPCs.length)];
                authorId = randNPC.id;
                authorName = randNPC.name;
                authorAvatar = randNPC.avatar || '👤';
                systemPrompt = `你是${authorName}，一个普通的论坛用户。请以你的身份在论坛发一篇帖子，帖子必须有标题。内容可以是讨论、吐槽、分享日常等，语气自然口语化。`;
                break;
        }

        // 构建用户提示词
        let lengthRequirement = '';

        // 只有 writer 类型才使用 template 设置长度
        if (posterType === 'writer' && template) {
            if (template.outputLength === 'short') {
                lengthRequirement = '字数要求：500-1000字';
            } else if (template.outputLength === 'medium') {
                lengthRequirement = '字数要求：约3000字';
            } else if (template.outputLength === 'long') {
                lengthRequirement = '字数要求：5000字以上';
            }
        }

        if (posterType === 'writer' && selectedPair) {
            userPrompt = `请写一篇关于 ${selectedPair.characterA.name} 和 ${selectedPair.characterB.name} 的同人短文，${lengthRequirement}。可以设定不同的 IF 线（如校园、古风、末世等）。帖子必须有标题和正文，并带上相关标签。

${forceTags.length > 0 ? '【重要】你必须带上以下标签：' + forceTags.join(' ') : ''}

请输出 JSON 格式：
{
    "title": "帖子标题（10-30字）",
    "content": "帖子正文",
    "tags": ["#标签1#", "#标签2#"]
}
只输出 JSON，不要有其他文字。`;
        } else {
            userPrompt = `请以你的身份发一篇论坛帖子。帖子必须有标题、正文，并带上相关标签。

${forceTags.length > 0 ? '【重要】你必须带上以下标签：' + forceTags.join(' ') : ''}

请输出 JSON 格式：
{
    "title": "帖子标题（10-30字）",
    "content": "帖子正文",
    "tags": ["#标签1#", "#标签2#"]
}
只输出 JSON，不要有其他文字。`;
        }

        try {
            const aiResponse = await this.callAIForDynamic(systemPrompt + '\n\n' + userPrompt, { temperature: 0.8 });

            if (!aiResponse) return null;

            // 1. 提取 JSON 对象 - 使用更精确的提取方法
            let jsonStr = aiResponse;

            // 移除代码块标记（有些模型会用 ```json ... ``` 包裹）
            jsonStr = jsonStr.replace(/```json\s*/g, '').replace(/```\s*/g, '');

            // 尝试找到最外层的 { 和对应的 }
            const firstBrace = jsonStr.indexOf('{');
            if (firstBrace !== -1) {
                // 从第一个 { 开始，数括号深度找对应的 }
                let depth = 0;
                let inString = false;
                let escapeNext = false;
                let lastBrace = -1;

                for (let i = firstBrace; i < jsonStr.length; i++) {
                    const ch = jsonStr[i];

                    if (escapeNext) {
                        escapeNext = false;
                        continue;
                    }

                    if (ch === '\\') {
                        escapeNext = true;
                        continue;
                    }

                    if (ch === '"' && !escapeNext) {
                        inString = !inString;
                    }

                    if (!inString) {
                        if (ch === '{') depth++;
                        if (ch === '}') {
                            depth--;
                            if (depth === 0) {
                                lastBrace = i;
                                break;
                            }
                        }
                    }
                }

                if (lastBrace !== -1) {
                    jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
                } else {
                    console.warn('[论坛AI] 未找到匹配的闭合括号，使用原始字符串');
                    jsonStr = jsonStr.substring(firstBrace);
                }
            } else {
                console.warn('[论坛AI] 未找到 JSON 起始括号，AI原始返回:', aiResponse.substring(0, 200));
                return null;
            }

            // 2. 预处理 content 字段中的特殊字符（将未转义的换行等转为转义形式）
            // 将 jsonStr 中字符串值内的真实换行符暂时替换为占位符，避免干扰后续解析
            jsonStr = jsonStr.replace(/"content"\s*:\s*"([\s\S]*?)("(?=\s*[,}]))/g, function(match, content, closingQuote) {
                const escaped = content
                    .replace(/\r\n/g, '\\n')
                    .replace(/\n/g, '\\n')
                    .replace(/\r/g, '\\n')
                    .replace(/\t/g, '\\t');
                return '"content": "' + escaped + '"';
            });

            // 也处理 title 和 tags 字段中可能存在的特殊字符
            jsonStr = jsonStr.replace(/"title"\s*:\s*"([\s\S]*?)("(?=\s*[,}]))/g, function(match, title, closingQuote) {
                const escaped = title.replace(/\r\n/g, '\\n').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
                return '"title": "' + escaped + '"';
            });

            // 3. 确保 JSON 结束完整
            if (!jsonStr.endsWith('}')) {
                jsonStr = jsonStr + '}';
            }

            // 6. 尝试解析
            let postData;
            try {
                postData = JSON.parse(jsonStr);
            } catch (parseError) {
                console.warn('[论坛AI] JSON 解析失败1:', parseError.message);
                console.warn('[论坛AI] 失败的 JSON 前500字符:', jsonStr.substring(0, 500));

                // 如果仍然失败，尝试只提取 title、content、tags 三个字段
                const titleMatch = jsonStr.match(/"title"\s*:\s*"((?:\\.|[^"\\])*)"/);
                const contentMatch = jsonStr.match(/"content"\s*:\s*"((?:\\"|[^"])*)"/);
                const tagsMatch = jsonStr.match(/"tags"\s*:\s*(\[[^\]]*\])/);

                if (!titleMatch || !contentMatch) {
                    console.error('[论坛AI] 无法提取必要字段');
                    return null;
                }

                postData = {
                    title: titleMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
                    content: (contentMatch[1] || '').replace(/\\n/g, '\n').replace(/\\"/g, '"'),
                    tags: tagsMatch ? JSON.parse(tagsMatch[1]) : []
                };
                console.log('[论坛AI] 降级解析成功，标题:', postData.title.substring(0, 30));
            }

            if (!postData.title || !postData.content) {
                return null;
            }

            // 7. 还原 content 中的转义换行符为实际换行符（因为后面显示需要原始换行）
            postData.content = postData.content
                .replace(/\\n/g, '\n')
                .replace(/\\t/g, '\t')
                .replace(/\\"/g, '"');

            // 合并强制标签和 AI 生成的标签
            let finalTags = forceTags.slice(); // 先复制强制标签
            if (postData.tags && Array.isArray(postData.tags)) {
                postData.tags.forEach(tag => {
                    if (!finalTags.includes(tag)) {
                        finalTags.push(tag);
                    }
                });
            }
            // 限制最多 5 个标签
            finalTags = finalTags.slice(0, 5);

            // 创建帖子对象
            const newPost = {
                id: Date.now() + Math.random(),
                authorId: authorId,
                authorName: authorName,
                title: postData.title,
                content: postData.content.replace(/\\n/g, '\n').replace(/\\"/g, '"'),
                tags: finalTags,
                time: '刚刚',
                likes: 0,
                likedBy: [],
                comments: [],
                commentsCount: 0,
                isLiked: false,
                timestamp: new Date().toISOString(),
                isAuto: true
            };

            // 添加到论坛帖子数组
            this.forumPosts.unshift(newPost);
            localStorage.setItem('forumData', JSON.stringify(this.forumPosts));

            console.log(`[论坛AI] 生成帖子成功: ${postData.title} (作者: ${authorName}, 标签: ${finalTags.join(', ')})`);

            this.showForumBadge();

            // 帖子生成成功后，延迟触发 AI 评论
            setTimeout(() => {
                this.generateAIForumComments(newPost.id);
            }, 2000);

            return newPost;
        } catch (error) {
            console.error('解析 AI 帖子失败:', error);
            return null;
        }
    }

    /**
     * 为论坛帖子生成 AI 评论（带关联规则）
     */
    async generateAIForumComments(postId) {
        const post = this.forumPosts.find(p => p.id === postId);
        if (!post) return;

    const authorId = post.authorId;
    const authorChat = this.getChat(authorId);

    // 收集所有必评身份（去重）
    const requiredIdentities = new Map(); // key: id, value: identity object

    // 1. 配对角色必评
    if (authorChat && authorChat.partnerIds && authorChat.partnerIds.length > 0) {
        for (const partnerId of authorChat.partnerIds) {
            const partnerChat = this.getChat(partnerId);
            if (partnerChat) {
                requiredIdentities.set(partnerId, {
                    id: partnerId,
                    name: partnerChat.nickname || partnerChat.remarkName || partnerChat.name,
                    avatar: partnerChat.avatar || '👤',
                    type: 'oc'
                });
            }
        }
    }

    // 2. 固定 NPC 关联 OC 必评
    if (authorId && authorId.startsWith('npc_')) {
        const npcData = this.findNPCData(authorId);
        if (npcData && npcData.relationToOC) {
            // relationToOC 可能是一个名字，需要找到对应的 OC ID
            const relatedOC = this.chats.find(c => !c.isGroup && c.id !== 'user_mummy' &&
                ((c.nickname || c.name) === npcData.relationToOC || c.name === npcData.relationToOC));
            if (relatedOC) {
                requiredIdentities.set(relatedOC.id, {
                    id: relatedOC.id,
                    name: relatedOC.nickname || relatedOC.remarkName || relatedOC.name,
                    avatar: relatedOC.avatar || '👤',
                    type: 'oc'
                });
            }
        }
    }

    // 3. 写手帖世界观 OC 必评
    if (authorId && authorId.startsWith('writer_') && post.tags && this.worldBooks) {
        for (const tag of post.tags) {
            // 去掉#号
            const tagName = tag.replace(/#/g, '').trim();
            // 查找匹配的世界观
            const matchedWorld = this.worldBooks.find(w => w.name === tagName);
            if (matchedWorld) {
                // 找出所有该世界观下的 OC
                const worldOCs = this.chats.filter(c => !c.isGroup && c.worldId === matchedWorld.id);
                worldOCs.forEach(oc => {
                    requiredIdentities.set(oc.id, {
                        id: oc.id,
                        name: oc.nickname || oc.remarkName || oc.name,
                        avatar: oc.avatar || '👤',
                        type: 'oc'
                    });
                });
                break; // 暂时只匹配第一个命中的世界观
            }
        }
    }

    // 4. 收集已有身份，用于后续随机选择
    const allIdentities = this.getAllIdentities().filter(i => i.id !== authorId && i.id !== 'user_mummy');
    const existingIds = new Set(requiredIdentities.keys());

    // 5. 构建最终评论者列表
    const commenters = [];
    // 先添加必评身份
    for (const [, identity] of requiredIdentities) {
        commenters.push(identity);
    }

    // 6. 随机补充其他角色和路人，使总数在设定范围内
    const forumSettings = this.mammySettings.autoGenerate.forum;
    const minComments = forumSettings.commentMin ?? 3;
    const maxComments = forumSettings.commentMax ?? 6;
    const targetCount = Math.floor(Math.random() * (maxComments - minComments + 1)) + minComments;
    const remainingCount = Math.max(0, targetCount - commenters.length);

    if (remainingCount > 0) {
        // 从未被选择的身份中随机选取（让路人优先，OC 最多再来 2 个）
        const available = allIdentities.filter(i => !existingIds.has(i.id));
        const ocAvailable = available.filter(i => i.type === 'oc' || i.type === 'character');
        const npcAvailable = available.filter(i => i.type !== 'oc' && i.type !== 'character');
        const maxOC = Math.min(2, ocAvailable.length);
        const selectedOCs = [...ocAvailable].sort(() => Math.random() - 0.5).slice(0, maxOC);
        const remainingNPCs = remainingCount - selectedOCs.length;
        const selectedNPCs = [...npcAvailable].sort(() => Math.random() - 0.5).slice(0, Math.max(0, remainingNPCs));
        const shuffled = [...selectedOCs, ...selectedNPCs];
        commenters.push(...shuffled);
    }

    // 7. 准备点赞相关数据
    const likeMin = this.mammySettings.autoGenerate.forum.likeMin ?? 2;
    const likeMax = this.mammySettings.autoGenerate.forum.likeMax ?? 5;
    const availableLikers = this.getAllIdentities().filter(i => i.id !== authorId && i.id !== 'user_mummy');
    const maxLikes = Math.min(Math.floor(Math.random() * (likeMax - likeMin + 1)) + likeMin, availableLikers.length);
    let likeCount = 0;

    // 8. 逐一生成本评论（不重复），穿插点赞
    for (let i = 0; i < commenters.length; i++) {
        const identity = commenters[i];
        // 间隔 5-10 秒，避免触发 API 限流
        await new Promise(r => setTimeout(r, 5000 + Math.random() * 5000));

        const comment = await this.callAIForForumComment(identity, post);
        if (comment) {
            if (!post.comments) post.comments = [];
            const reactions = this.generateCommentReactions(comment);
            post.comments.unshift({
                id: Date.now() + Math.random(),
                authorId: identity.id,
                content: comment,
                time: '刚刚',
                timestamp: new Date().toISOString(),
                isAuto: true,
                likes: reactions.likes,
                dislikes: reactions.dislikes,
                likedBy: reactions.likedBy,
                dislikedBy: reactions.dislikedBy
            });
            post.commentsCount = post.comments.length;

            // [新增] 配对角色追评：如果评论者与某个角色是配对关系，且该角色尚未在这条评论下发言，则概率触发该角色回复
            const commentAuthor = this.getChat(identity.id);
            if (commentAuthor && commentAuthor.partnerIds && commentAuthor.partnerIds.length > 0) {
                for (const partnerId of commentAuthor.partnerIds) {
                    const partnerChat = this.getChat(partnerId);
                    if (!partnerChat || partnerId === post.authorId) continue; // 不和自己配对，也不和帖子作者重复（作者回复已有其他逻辑）
                    // 防止自己追评自己
                    if (comment.authorId === partnerId) continue;
                    // 该评论下还没有这个配对角色发言过
                    const alreadyReplied = post.comments.some(c => c.parentId === comment.id && c.authorId === partnerId);
                    if (!alreadyReplied && Math.random() < 0.8) {
                        // 随机延迟，避免太整齐
                        await new Promise(r => setTimeout(r, 2000 + Math.random() * 4000));
                        const partnerComment = await this.callAIForForumComment(partnerChat, post, comment);
                        if (partnerComment) {
                            const partnerReactions = this.generateCommentReactions(partnerComment);
                            post.comments.push({
                                id: Date.now() + Math.random(),
                                authorId: partnerId,
                                content: partnerComment,
                                time: '刚刚',
                                timestamp: new Date().toISOString(),
                                parentId: comment.id,
                                isAuto: true,
                                likes: partnerReactions.likes,
                                dislikes: partnerReactions.dislikes,
                                likedBy: partnerReactions.likedBy,
                                dislikedBy: partnerReactions.dislikedBy
                            });
                            post.commentsCount = post.comments.length;
                        }
                    }
                }
            }

            localStorage.setItem('forumData', JSON.stringify(this.forumPosts));
            this.renderForum(false);
        }

        // 每生成 1-2 条评论后，有概率插入一个点赞
        if (Math.random() < 0.5 && likeCount < maxLikes) {
            const liker = availableLikers[likeCount];
            if (liker) {
                await this.addSingleLike(post, liker);
                likeCount++;
            }
        }
    }

    // 9. 使用新的 AI 点赞逻辑替换原来的循环
    // 9.1 分离 OC 和路人
    const ocLikers = availableLikers.filter(i => i.type === 'oc' || i.type === 'character');
    const nonOCLikers = availableLikers.filter(i => i.type !== 'oc' && i.type !== 'character');

    // 9.2 让每个 OC 用 AI 判断是否点赞
    const likingOCs = [];
    for (const oc of ocLikers) {
        const shouldLike = await this.shouldOCLike(postId, oc);
        if (shouldLike) {
            likingOCs.push(oc);
        }
    }

    // 9.3 先让决定点赞的 OC 点赞
    for (const oc of likingOCs) {
        if (likeCount >= maxLikes) break;
        await this.addSingleLike(post, oc);
        likeCount++;
    }

    // 9.4 剩余的点赞名额由路人随机补充
    if (likeCount < maxLikes && nonOCLikers.length > 0) {
        const neededLikes = maxLikes - likeCount;
        const shuffledNPCs = [...nonOCLikers].sort(() => Math.random() - 0.5);
        const selectedNPCs = shuffledNPCs.slice(0, Math.min(neededLikes, shuffledNPCs.length));

        for (const npc of selectedNPCs) {
            await this.addSingleLike(post, npc);
            likeCount++;
        }
    }

    // 9.5. 触发帖子作者回复部分评论（配对角色评论必回）
    if (authorChat && authorId !== 'user_mummy') {
        const postComments = post.comments || [];

        for (const comment of postComments) {
            // 跳过作者自己的评论，避免自己回复自己
            if (comment.authorId === authorId) continue;
            // 跳过已经被作者回复过的评论（检查是否已有回复）
            if (postComments.some(c => c.parentId === comment.id)) continue;

            // 判断是否需要回复
            const isPartner = authorChat.partnerIds && authorChat.partnerIds.includes(comment.authorId);
            let shouldReply = isPartner; // 配对角色评论必须回复

            if (!isPartner) {
                // 非配对角色：30% 概率回复
                shouldReply = Math.random() < 0.3;
            }

            if (shouldReply) {
                // 随机延迟，模拟阅读和思考
                await new Promise(r => setTimeout(r, 3000 + Math.random() * 5000));

                const replyContent = await this.callAIForForumComment(authorChat, post, comment);
                if (replyContent) {
                    post.comments.push({
                        id: Date.now() + Math.random(),
                        authorId: authorId,
                        content: replyContent,
                        time: '刚刚',
                        timestamp: new Date().toISOString(),
                        parentId: comment.id,
                        isAuto: true
                    });
                    post.commentsCount = post.comments.length;
                    localStorage.setItem('forumData', JSON.stringify(this.forumPosts));
                    this.renderForum(false);
                }
            }
        }
    }

    // 9.8. 争议性互动链（黑粉、CP粉争论、多层嵌套）
    const maxTotalComments = forumSettings.commentMax; // 从设置中读取最大评论数
    let currentTotal = (post.comments || []).length;

    if (currentTotal < maxTotalComments && post.comments && post.comments.length > 0) {
        // 选取部分一级评论作为”争议点”，每种争议点都可能引发争论
        const topComments = post.comments.filter(c => !c.parentId);
        const controversialComments = topComments.filter(() => Math.random() < 0.3); // 30% 评论引发争议

        for (const targetComment of controversialComments) {
            if (currentTotal >= maxTotalComments) break;

            // 1. 黑粉或CP粉前来反驳
            const isCP = targetComment.authorId &&
                         post.authorId &&
                         authorChat?.partnerIds?.includes(targetComment.authorId);
            const personaType = Math.random() < (isCP ? 0.7 : 0.3) ? 'cpfan' : 'hater'; // CP相关更易吸引CP粉
            const personaIdentity = this.createPersonaIdentity(personaType);

            if (personaIdentity) {
                const hateComment = await this.callAIForForumComment(personaIdentity, post, targetComment);
                if (hateComment) {
                    post.comments.push({
                        id: Date.now() + Math.random(),
                        authorId: personaIdentity.id,
                        content: hateComment,
                        time: '刚刚',
                        timestamp: new Date().toISOString(),
                        parentId: targetComment.id,
                        isAuto: true
                    });
                    currentTotal++;
                    if (currentTotal >= maxTotalComments) break;
                }
            }

            // 2. 原评论者回击（50%概率）
            if (currentTotal < maxTotalComments && Math.random() < 0.5 && targetComment.authorId) {
                const originalCommenter = this.getChat(targetComment.authorId);
                if (originalCommenter) {
                    const reply = await this.callAIForForumComment(originalCommenter, post, targetComment);
                    if (reply) {
                        post.comments.push({
                            id: Date.now() + Math.random(),
                            authorId: targetComment.authorId,
                            content: reply,
                            time: '刚刚',
                            timestamp: new Date().toISOString(),
                            parentId: targetComment.id,
                            isAuto: true
                        });
                        currentTotal++;
                    }
                }
            }

            // 3. 偶尔再引第三方入场（30%概率）
            if (currentTotal < maxTotalComments && Math.random() < 0.3) {
                const bystander = this.getRandomBystanderIdentity(post);
                if (bystander) {
                    const bystanderComment = await this.callAIForForumComment(bystander, post, targetComment);
                    if (bstanderComment) {
                        post.comments.push({
                            id: Date.now() + Math.random(),
                            authorId: bystander.id,
                            content: bystanderComment,
                            time: '刚刚',
                            timestamp: new Date().toISOString(),
                            parentId: targetComment.id,
                            isAuto: true
                        });
                        currentTotal++;
                    }
                }
            }

            // 如果接近上限则停止争议链
            if (currentTotal >= maxTotalComments - 2) break;
        }
    }

    // 9.9. 延迟触发角色和路人给评论互赞互踩
    const allCommentIds = (post.comments || []).map(c => c.id);
    if (allCommentIds.length > 0) {
        // 随机延迟 10-30 秒后开始
        const delay = 10000 + Math.random() * 20000;
        setTimeout(async () => {
            const availableActors = this.getAllIdentities().filter(i => i.id !== post.authorId);
            // 随机选几个角色/路人来互动
            const actorCount = Math.min(Math.floor(Math.random() * 5) + 3, availableActors.length);
            const shuffledActors = [...availableActors].sort(() => Math.random() - 0.5).slice(0, actorCount);

            for (const actor of shuffledActors) {
                // 每人随机选 1-3 条评论来赞或踩
                const targetCount = Math.floor(Math.random() * 3) + 1;
                const shuffledComments = [...allCommentIds].sort(() => Math.random() - 0.5).slice(0, targetCount);

                for (const commentId of shuffledComments) {
                    const comment = post.comments.find(c => c.id === commentId);
                    if (!comment) continue;

                    // 80% 赞，20% 踩（可以根据角色性格调整）
                    const isLike = Math.random() < 0.8;
                    if (isLike) {
                        comment.likes = (comment.likes || 0) + 1;
                        comment.likedBy = comment.likedBy || [];
                        comment.likedBy.push(actor.name);
                    } else {
                        comment.dislikes = (comment.dislikes || 0) + 1;
                        comment.dislikedBy = comment.dislikedBy || [];
                        comment.dislikedBy.push(actor.name);
                    }

                    // 心情影响：被赞开心，被踩不开心
                    if (comment.authorId && comment.authorId !== 'user_mummy') {
                        const commentAuthor = this.getChat(comment.authorId);
                        if (commentAuthor) {
                            if (!commentAuthor.tempMoodModifiers) commentAuthor.tempMoodModifiers = [];
                            commentAuthor.tempMoodModifiers.push({
                                type: isLike ? 'comment_liked' : 'comment_disliked',
                                value: isLike ? 0.05 : -0.05,
                                expireAt: Date.now() + 30 * 60 * 1000 // 30分钟有效期
                            });
                        }
                    }
                }
            }

            localStorage.setItem('forumData', JSON.stringify(this.forumPosts));
            this.renderForum(false);
        }, delay);
    }

    // 10. 触发角色自动转发论坛帖子
    await this.triggerForumPostForward(postId);
}

    /**
     * 为帖子自动添加一些随机点赞（模拟路人、角色等）
     * @param {number} postId - 帖子 ID
     */
    async generateAILikes(postId) {
        const post = this.forumPosts.find(p => p.id === postId);
        if (!post) return;

        if (!post.likedBy) post.likedBy = [];

        // 获取所有可用的身份（排除作者和已经点赞的）
        const allIds = this.getAllIdentities()
            .filter(i => i.id !== post.authorId && !post.likedBy.includes(i.name));

        if (allIds.length === 0) return;

        // 随机选择点赞人数（从设置中读取范围）
        const likeMin = this.mammySettings.autoGenerate.forum.likeMin ?? 2;
        const likeMax = this.mammySettings.autoGenerate.forum.likeMax ?? 5;
        const count = Math.min(Math.floor(Math.random() * (likeMax - likeMin + 1)) + likeMin, allIds.length);

        // 将所有身份合并并完全随机打乱，避免 OC 总是优先
        const shuffled = [...allIds].sort(() => Math.random() - 0.5);

        // 逐个添加点赞，模拟真实感
        for (const identity of shuffled) {
            const chat = this.getChat(identity.id);
            // 获取显示名称
            let displayName = identity.name;
            if (chat) {
                displayName = chat.nickname || chat.remarkName || chat.name;
            }
            post.likedBy.push(displayName);
            post.likes = post.likedBy.length;

            // 每次添加后保存并刷新 UI
            localStorage.setItem('forumData', JSON.stringify(this.forumPosts));
            this.renderForum(false);

            // 随机间隔 300-800ms，模拟逐一有人点赞
            await new Promise(r => setTimeout(r, 300 + Math.random() * 500));
        }
        console.log(`[自动点赞] 为帖子 ${postId} 添加了 ${shuffled.length} 个点赞`);
    }

    /**
     * 为帖子添加单个点赞
     * @param {Object} post - 帖子对象
     * @param {Object} identity - 点赞者身份
     */
    async addSingleLike(post, identity) {
        if (!post.likedBy) post.likedBy = [];

        // 检查是否已经点赞
        if (post.likedBy.includes(identity.name)) return;

        const chat = this.getChat(identity.id);
        // 获取显示名称
        let displayName = identity.name;
        if (chat) {
            displayName = chat.nickname || chat.remarkName || chat.name;
        }

        post.likedBy.push(displayName);
        post.likes = post.likedBy.length;

        // 保存并刷新 UI
        localStorage.setItem('forumData', JSON.stringify(this.forumPosts));
        this.renderForum(false);

        // 随机间隔 300-800ms，模拟逐一有人点赞
        await new Promise(r => setTimeout(r, 300 + Math.random() * 500));
    }

    /**
     * 判断 OC 是否应该点赞某个帖子（AI 判断）
     * @param {string} postId - 帖子 ID
     * @param {Object} oc - OC 身份对象
     * @returns {boolean} - 是否点赞
     */
    async shouldOCLike(postId, oc) {
        const post = this.forumPosts.find(p => p.id === postId);
        if (!post) return false;

        // 如果帖子 likedBy 已包含该 OC 的名字，直接返回 false
        if (post.likedBy && post.likedBy.includes(oc.name)) {
            return false;
        }

        // 如果 API 未配置，按 oc.replyTemp || 0.5 的概率随机返回
        if (!this.isAPIConfigured()) {
            const likeProbability = oc.replyTemp || 0.5;
            return Math.random() < likeProbability;
        }

        // 调用 AI 判断
        const chat = this.getChat(oc.id);
        if (!chat) return false;

        // 构建提示词
        const prompt = `你是一个OC角色，你的信息：
名字：${oc.name}
性格：${chat.characterInfo || '普通性格'}

现在有一个论坛帖子：
标题：${post.title}
内容：${post.content}
作者：${post.authorId}

请根据你的性格和帖子内容，判断你是否会点赞这个帖子。如果会点赞，请回复"true"，否则回复"false"。只需要回复 true 或 false，不需要其他内容。`;

        try {
            const result = await this.callAIForDynamic(prompt, {
                temperature: 0.7,
                maxTokens: 10
            });

            // 清理返回结果，只保留 true 或 false
            const cleanedResult = result.toLowerCase().trim();
            return cleanedResult === 'true';
        } catch (error) {
            console.error('shouldOCLike AI 调用失败:', error);
            // AI 调用失败时，使用随机概率
            const likeProbability = oc.replyTemp || 0.5;
            return Math.random() < likeProbability;
        }
    }

    /**
     * 创建黑粉/CP粉身份
     */
    createPersonaIdentity(type) {
        if (type === 'hater') {
            return {
                id: `hater_${Date.now()}_${Math.random().toString(36).substr(2,5)}`,
                name: ['键盘侠小王', '杠精小李', '吃瓜群众001', '路人甲'][Math.floor(Math.random() * 4)],
                avatar: '😈',
                type: 'hater'
            };
        } else {
            return {
                id: `cpfan_${Date.now()}_${Math.random().toString(36).substr(2,5)}`,
                name: ['CP粉头子', '磕到了星球', '民政局搬运工', '糖罐子'][Math.floor(Math.random() * 4)],
                avatar: '💖',
                type: 'cpfan'
            };
        }
    }

    /**
     * 随机路人身份
     */
    getRandomBystanderIdentity(post) {
        const bystanders = ['路人甲', '吃瓜群众', '网友小明', '论坛观察员'];
        return {
            id: `bystander_${Date.now()}_${Math.random().toString(36).substr(2,5)}`,
            name: bystanders[Math.floor(Math.random() * bystanders.length)],
            avatar: '👀',
            type: 'bystander'
        };
    }

    /**
     * 触发角色自动转发论坛帖子（仿照动态转发规则）
     */
    async triggerForumPostForward(postId) {
        const post = this.forumPosts.find(p => p.id === postId);
        if (!post) return;

        // 收集群聊中的 NPC 和所有单聊角色
        let characters = this.chats.filter(c => !c.isGroup && c.id !== 'user_mummy');

        // 从所有群聊中提取 NPC 成员
        const seenNPCs = new Set();
        this.chats.forEach(chat => {
            if (chat.isGroup && chat.members) {
                chat.members.forEach(memberId => {
                    if (memberId.startsWith('npc_') && !seenNPCs.has(memberId)) {
                        seenNPCs.add(memberId);
                        // 构造一个类似 chat 的对象供后续使用
                        const npcInfo = this.getMemberDisplayInfo(memberId);
                        const npcData = this.findNPCData(memberId);
                        characters.push({
                            id: memberId,
                            name: npcInfo.name,
                            nickname: npcInfo.name,
                            remarkName: '',
                            partnerIds: [],
                            isNPC: true,
                            npcData: npcData
                        });
                    }
                });
            }
        });
        if (characters.length === 0) return;

        // 逐个角色判断是否转发（异步但不用await阻塞）
        const tasks = characters.map(async (chat) => {
            // 随机延迟 1-5 秒，避免同时调用 API
            await new Promise(r => setTimeout(r, 1000 + Math.random() * 4000));
            await this.forwardForumPostByCharacter(chat, post);
        });

        // 不等待全部完成，让它们异步执行
        Promise.allSettled(tasks).then(() => {
            console.log('[论坛自动转发] 全部角色判断完成');
        });
    }

    async callAIForForumComment(identity, post, parentComment = null) {
        const chat = this.getChat(identity.id);
        const authorName = identity.name;
        if (!authorName) return null;

    const truncatedTitle = post.title.length > 30 ? post.title.substring(0, 30) + '...' : post.title;
    const truncatedContent = post.content.substring(0, 300);

    // 确定评论者的身份标签和语气
    let personaTag = '路人';
    let roleInstruction = '';

    if (chat && post.authorId && chat.partnerIds?.includes(post.authorId)) {
        // 配对角色：亲昵、调侃、日常感
        personaTag = 'CP';
        const partnerNames = chat.partnerIds.map(pid => {
            const p = this.getChat(pid);
            return p ? (p.nickname || p.name) : pid;
        }).join('、');
        const postAuthorName = (() => {
            const authorChat = this.getChat(post.authorId);
            if (!authorChat) return post.authorName || '对方';
            return authorChat.nickname || authorChat.remarkName || authorChat.name || post.authorName || '对方';
        })();
        roleInstruction = `你是${authorName}。发帖人${postAuthorName}是你的配对角色，你在论坛刷到了对方的帖子。请用非常自然的语气写一句短评论（10-30字），像平时聊天一样，可以调侃、吐槽、关心或害羞。禁止写"支持""写得真好"等空洞夸奖。直接输出评论。`;
    } else if (chat) {
        // 其他 OC 角色：根据性格自然评论（不一定夸）
        personaTag = 'OC';
        const personality = chat.personalityPrompt || '';
        let styleHint = '';
        if (personality.includes('傲娇') || personality.includes('冷漠') || personality.includes('毒舌')) {
            styleHint = '你的性格带点傲娇/冷漠，评论可以稍微冷淡、挑剔或嘴硬心软。';
        } else if (personality.includes('温柔') || personality.includes('善良') || personality.includes('体贴')) {
            styleHint = '你性格温和，评论会比较友善、鼓励。';
        } else if (personality.includes('活泼') || personality.includes('开朗') || personality.includes('话多')) {
            styleHint = '你性格活泼，评论可以带点玩笑、活泼。';
        } else {
            styleHint = '按照你的真实性格自然评论。';
        }
        roleInstruction = `你是${authorName}。你刷到了一个新的帖子。${styleHint}请写一句简短的评论（10-30字），可以表示赞同、反驳、疑惑、补充等，不要总是夸奖，要像真人的反应。禁止写"支持""写得真好"。直接输出评论。`;
    } else if (identity.type === 'fixedNPC') {
        personaTag = '固定NPC';
        roleInstruction = `你是${authorName}，与帖子作者有特定关系。请根据你的了解写一句简短的评论（10-30字），要有真实的情绪反应。直接输出评论。`;
    } else {
        // 随机分配视角：路人、CP粉、黑粉、理智网友
        const rand = Math.random();
        if (rand < 0.25) {
            personaTag = 'CP粉';
            roleInstruction = `你是一个狂热的CP粉。看到一篇同人/讨论帖，你非常激动。请用粉丝口吻写一句简短的评论（10-30字），可以尖叫、磕到了、求更多等，语气夸张一点。直接输出评论。`;
        } else if (rand < 0.45) {
            personaTag = '黑粉';
            roleInstruction = `你是一个不太友善的网友，喜欢挑刺或唱反调。请写一句简短的评论（10-30字），可以质疑、嘲讽、不屑，但不要人身攻击。直接输出评论。`;
        } else if (rand < 0.7) {
            personaTag = '理智网友';
            roleInstruction = `你是一个理性思考的网友。请写一句有观点的简评（10-30字），可以分析、提出疑问或补充看法。直接输出评论。`;
        } else {
            personaTag = '路人';
            roleInstruction = `你是一个普通路人，随便看看帖子。请写一句很随意的评论（10-30字），可以表达无聊、有趣、没看懂等，要真实。直接输出评论。`;
        }
    }

    // 构建消息：标准的 system + user 格式
    const systemPrompt = `你是一个论坛用户。请按照指示，直接写一句简短的评论。绝对不要思考、解释或铺垫，直接输出评论文字。禁止任何前缀或后缀。`;

    const userPrompt = `${roleInstruction}\n\n帖子标题：《${truncatedTitle}》\n帖子内容：${truncatedContent}
${parentComment ? `\n你正在回复 ${parentComment.authorName} 的评论："${parentComment.content}"\n` : '\n'}
请只输出一句评论（例如"期待后续！"或"这段写得太好了"），不要有任何其他文字：`;

    const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
    ];

    const settings = this.mammySettings;
    // 如果未配置 API，使用降级策略
    if (!settings.apiUrl || !settings.apiKey || !settings.modelName) {
        console.warn('API 未配置，使用降级评论模板');
        return this.getFallbackComment(personaTag);
    }

    try {
        console.log(`[AI论坛评论-请求] 角色: ${authorName}, 身份标签: ${personaTag}`);

        const response = await fetch(settings.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${settings.apiKey}`
            },
            body: JSON.stringify({
                model: settings.modelName,
                messages: messages,
                temperature: 0.85,
                reasoning_effort: "low",
                stop: ["\n\n"]
            })
        });

        if (!response.ok) {
            console.warn(`AI 评论 API 请求失败 (${response.status})，使用降级评论`);
            return this.getFallbackComment(personaTag);
        }

        const data = await response.json();
        console.log('[AI论坛评论-完整响应]', JSON.stringify(data).substring(0, 300));

        // 详细检查 choices 结构
        if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
            console.warn('AI 评论响应无 choices 数组，完整响应:', JSON.stringify(data));
            return this.getFallbackComment(personaTag);
        }

        const choice = data.choices[0];
        console.log('[AI论坛评论-choice]', JSON.stringify(choice).substring(0, 200));

        // 检查多种可能的字段名
        let content = choice?.message?.content || choice?.text || choice?.content || '';

        if (!content || content.trim() === '') {
            console.warn('AI 评论 content 为空，message 对象:', JSON.stringify(choice.message || {}));
            console.warn('完整 choice:', JSON.stringify(choice));
            return this.getFallbackComment(personaTag);
        }

        console.log('[AI论坛评论-原始内容]', content);

        // 清理内容
        content = content.replace(/\[emotion:\w+\]/gi, '').trim();
        content = content.replace(/^["']|['"]$/g, '').trim();
        content = content.replace(/（.*?）/g, '').trim();
        content = content.replace(/\(.*?\)/g, '').trim();

        if (!content || content.length === 0) {
            console.warn('AI 评论清理后为空，使用降级评论');
            return this.getFallbackComment(personaTag);
        }

        if (content.length > 50) content = content.substring(0, 50);

        console.log('[AI论坛评论-成功]', content);
        return content;

    } catch (error) {
        console.error('AI 评论生成失败:', error);
        return this.getFallbackComment(personaTag);
    }
}

    /**
     * 降级评论生成器（当 API 不可用或失败时使用）
     * @param {string} personaTag - 评论者标签
     * @returns {string} 评论内容
     */
    getFallbackComment(personaTag) {
        const commentsByTag = {
            'CP': [
                '你发这个他看到了吗', '甜死我了', '撤回！对你不好！', '啊啊啊你俩',
                '你终于发帖了！想死你了', '给你点赞，必须的', '你怎么这么会写',
                '看哭了，你们要好好的', '我永远支持你', '有人心里乐开花了吧'
            ],
            '路人': [
                '有点意思', '看完沉默了', '这内容挺真实的', '顶一下，说得不错',
                '哈哈哈哈笑死我了', '说得好', '这个角度我没想到', '还行吧',
                '认真看完了，留个脚印', '今天论坛好热闹'
            ],
            'CP粉': [
                'kswl！', '太好磕了吧', '啊啊啊我CP', '你们就是真的',
                '是谁又磕到了？是我！', '求更多这种内容', '我圈有您了不起', '我死了',
                '甜到牙疼', '民政局自己来了'
            ],
            '理智网友': [
                '值得深思', '角度新颖', '说得不错', '有道理',
                '赞同分析', '收藏了', '期待更多深度内容', '分析到位',
                '这个观点有意思', '难得一见的好贴'
            ],
            '固定NPC': [
                '我认识的某人也是这样', '真实', '给你点赞', '说得好', '顶顶',
                '有道理', '了解', '支持一下'
            ],
            '黑粉': [
                '就这？', '我不理解', '建议清醒一点', '炒作吧这是', '无聊',
                '看过更好的', '呵呵', '一言难尽'
            ]
        };

        const pool = commentsByTag[personaTag] || commentsByTag['路人'];
        return pool[Math.floor(Math.random() * pool.length)];
    }

    /**
     * 延迟生成点赞和评论
     */
    generateDelayedLikesAndComments(postId) {
        const post = this.forumPosts.find(p => p.id === postId);
        if (!post) return;

        // 获取所有随机NPC身份
        const identities = this.getAllIdentities();

        // 延迟10-20秒生成1-3个随机点赞
        const likeDelay = 10000 + Math.random() * 10000; // 10-20秒
        setTimeout(() => {
            const likeCount = Math.floor(Math.random() * 3) + 1; // 1-3个点赞
            if (!post.likedBy) post.likedBy = [];

            for (let i = 0; i < likeCount; i++) {
                const randomIdentity = identities[Math.floor(Math.random() * identities.length)];
                const nickname = randomIdentity.name || '匿名';
                if (!post.likedBy.includes(nickname)) {
                    post.likedBy.push(nickname);
                }
            }
            post.likes = post.likedBy.length;
            localStorage.setItem('forumData', JSON.stringify(this.forumPosts));
            this.renderForum(false);
        }, likeDelay);

        // 延迟20-40秒生成1-3条评论
        const commentDelay = 20000 + Math.random() * 20000; // 20-40秒
        setTimeout(() => {
            const commentCount = Math.floor(Math.random() * 3) + 1; // 1-3条评论
            const templates = [
                '支持！', '说得很好！', '有道理', '赞同', '确实如此',
                '我也这么觉得', '说得太对了', '完全支持', '很棒！'
            ];

            for (let i = 0; i < commentCount; i++) {
                const randomIdentity = identities[Math.floor(Math.random() * identities.length)];
                const content = templates[Math.floor(Math.random() * templates.length)];
                const newComment = {
                    id: Date.now() + i,
                    authorId: randomIdentity.id,
                    content: content,
                    time: this.getRelativeTime(new Date()),
                    timestamp: new Date().toISOString(),
                    isAuto: true
                };
                if (!post.comments) post.comments = [];
                post.comments.push(newComment);
            }
            post.commentsCount = post.comments.length;
            localStorage.setItem('forumData', JSON.stringify(this.forumPosts));
            this.renderForum(false);
        }, commentDelay);
    }

    /**
     * 显示@菜单
     */
    showAtMenu() {
        const characters = this.contacts.filter(c => !c.isGroup && c.id !== 'user_mummy');
        if (characters.length === 0) {
            this.showNotification('暂无可@的角色！');
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.style.zIndex = '3000';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 340px;">
                <div class="modal-header">
                    <h3>选择要 @ 的好友</h3>
                    <button class="close-btn" id="at-menu-close">✕</button>
                </div>
                <div class="modal-body" style="max-height: 300px; overflow-y: auto;">
                    <div class="contact-list">
                        ${characters.map(c => {
                            const chat = this.getChat(c.id);
                            const displayName = chat ? (chat.nickname || chat.remarkName || chat.name) : c.name;
                            const avatar = chat ? (chat.avatar || '👤') : (c.avatar || '👤');
                            return `
                                <div class="contact-item at-menu-item" data-name="${displayName}" style="display: flex; align-items: center; padding: 10px; cursor: pointer; border-radius: 8px; margin: 4px 0; transition: background 0.15s;">
                                    <div style="width: 36px; height: 36px; border-radius: 50%; background: var(--nav-active-bg); display: flex; align-items: center; justify-content: center; margin-right: 10px; font-size: 18px;">${avatar}</div>
                                    <span style="font-size: 14px;">${displayName}</span>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="cancel-btn" id="at-menu-cancel">取消</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const closeModal = () => modal.remove();

        modal.querySelector('#at-menu-close').onclick = closeModal;
        modal.querySelector('#at-menu-cancel').onclick = closeModal;
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });

        // 选择好友后插入 @用户名
        modal.querySelectorAll('.at-menu-item').forEach(item => {
            item.addEventListener('click', () => {
                const name = item.getAttribute('data-name');
                const contentInput = document.getElementById('post-content-input');
                if (contentInput) {
                    contentInput.value += `@${name} `;
                    contentInput.focus();
                }
                closeModal();
            });
            // hover 效果
            item.addEventListener('mouseenter', () => item.style.background = 'var(--bg-page)');
            item.addEventListener('mouseleave', () => item.style.background = '');
        });
    }

    /**
     * 编辑帖子
     */
    editPost(postId, event) {
        if (event) event.stopPropagation();
        const post = this.forumPosts.find(p => p.id === postId);
        if (!post) return;

        // 打开编辑弹窗（复用发帖弹窗）
        const modal = document.getElementById('create-post-modal');
        if (!modal) return;

        // 设置弹窗标题
        const modalHeader = modal.querySelector('.modal-header h3');
        if (modalHeader) {
            modalHeader.textContent = '编辑帖子';
        }

        // 填充现有内容
        document.getElementById('post-title-input').value = post.title || '';
        document.getElementById('post-content-input').value = post.content;
        // 处理图片字段（兼容旧版imageUrl和新版imageUrls）
        const postImages = post.imageUrls || (post.imageUrl ? [post.imageUrl] : []);
        document.getElementById('post-image-url').value = postImages.join('\n');
        // 更新预览
        this.updateImagePreview();

        // 修改提交按钮事件
        const submitBtn = modal.querySelector('.submit-btn');
        const originalOnclick = submitBtn.onclick;
        submitBtn.onclick = () => {
            const content = document.getElementById('post-content-input').value.trim();
            const imageUrls = document.getElementById('post-image-url').value.trim()
                .split('\n')
                .map(url => url.trim())
                .filter(url => url !== '')
                .slice(0, 10);

            if (!content) {
                this.showNotification('请输入帖子内容！');
                return;
            }

            // 更新帖子内容
            post.title = document.getElementById('post-title-input').value.trim();
            post.content = content;
            post.imageUrls = imageUrls.length > 0 ? imageUrls : null;
            post.time = '刚刚';
            post.timestamp = new Date().toISOString();

            // 保存到localStorage
            localStorage.setItem('forumData', JSON.stringify(this.forumPosts));

            // 重置论坛分页并刷新
            this.renderForum(false);

            // 关闭弹窗
            this.closeCreatePostModal();

            // 恢复原始提交按钮事件
            submitBtn.onclick = originalOnclick;
        };

        modal.classList.add('active');
    }

    /**
     * 删除帖子
     */
    deletePost(postId, event) {
        if (event) event.stopPropagation();
        const modal = document.getElementById('confirm-modal');
        const title = document.getElementById('confirm-modal-title');
        const message = document.getElementById('confirm-modal-message');
        const confirmBtn = document.getElementById('confirm-confirm-btn');
        const cancelBtn = document.getElementById('confirm-cancel-btn');
        if (!modal || !title || !message) return;
        title.textContent = '删除帖子';
        message.textContent = '确定要删除这条帖子吗？';
        modal.classList.add('active');
        const onConfirm = () => {
            const index = this.forumPosts.findIndex(p => p.id === postId);
            if (index !== -1) {
                this.forumPosts.splice(index, 1);
                localStorage.setItem('forumData', JSON.stringify(this.forumPosts));
                this.renderForum(false);
                this.showNotification('帖子已删除');
            }
            modal.classList.remove('active');
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
        };
        const onCancel = () => {
            modal.classList.remove('active');
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
        };
        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
    }

    /**
     * 根据标签筛选帖子
     */
    filterByTag(tag) {
        // 清除旧的筛选标记
        this.currentFilterTag = tag;
        this.isSearchMode = false;
        this.searchResults = null;
        this.forumPage = 1;  // 重置分页
        this.forumHasMore = true;
        // 重新渲染论坛列表，只显示包含此标签的帖子
        this.renderForum(false);
        this.showNotification(`正在查看标签：${tag}`);
    }

    /**
     * 清除标签筛选
     */
    clearTagFilter() {
        this.currentFilterTag = null;
        this.isSearchMode = false;
        this.searchResults = null;
        this.forumPage = 1;  // 重置分页
        this.forumHasMore = true;
        this.renderForum(false);
        this.showNotification('已清除筛选，查看全部帖子');
    }

    /**
     * 折叠/展开热搜榜
     */
    toggleHotRank() {
        const panel = document.getElementById('hot-rank-panel');
        const arrow = document.getElementById('hot-rank-arrow');
        if (!panel || !arrow) return;

        if (panel.style.display === 'none') {
            panel.style.display = 'block';
            arrow.textContent = '▼';
            this.renderHotRank('all');
        } else {
            panel.style.display = 'none';
            arrow.textContent = '▶';
        }
    }

    /**
     * 计算并渲染热搜榜
     */
    renderHotRank(period = 'all') {
        const now = new Date();
        let startDate = null;
        switch (period) {
            case 'today':
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                break;
            case 'week':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case 'month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
        }

        // 筛选时间范围内的帖子
        const filteredPosts = startDate
            ? this.forumPosts.filter(p => new Date(p.timestamp || Date.now()) >= startDate)
            : this.forumPosts;

        // 统计标签：记录每个标签的帖子数、总点赞数、总评论数
        const tagStats = {};
        filteredPosts.forEach(post => {
            if (post.tags && Array.isArray(post.tags)) {
                post.tags.forEach(tag => {
                    if (!tagStats[tag]) {
                        tagStats[tag] = { count: 0, likes: 0, comments: 0 };
                    }
                    tagStats[tag].count += 1;
                    tagStats[tag].likes += post.likes || 0;
                    tagStats[tag].comments += (post.comments || []).length;
                });
            }
        });

        // 综合热度 = 帖子数 × 2 + 点赞数 + 评论数
        const hotList = Object.entries(tagStats)
            .map(([tag, stats]) => ({
                tag,
                count: stats.count,
                heat: stats.count * 2 + stats.likes + stats.comments
            }))
            .sort((a, b) => b.heat - a.heat)
            .slice(0, 5);

        // 渲染
        const listEl = document.getElementById('hot-rank-list');
        if (!listEl) return;
        if (hotList.length === 0) {
            listEl.innerHTML = '<span style="color:var(--text-secondary); font-size:12px;">暂无热搜数据</span>';
            return;
        }
        listEl.innerHTML = hotList.map((item, index) => {
            const rank = index + 1;
            const top3Class = rank <= 3 ? ' top3' : '';
            return `
                <div class="hot-rank-item" onclick="chatManager.filterByTag('${item.tag}')">
                    <span class="hot-rank-index${top3Class}">${rank}</span>
                    <span class="hot-rank-tag">${item.tag}</span>
                    <span class="hot-rank-count">${item.count}帖</span>
                </div>
            `;
        }).join('');

        // 高亮当前时间维度按钮
        document.querySelectorAll('.hot-rank-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.period === period);
        });
    }

    /**
     * 在详情页中点赞/取消点赞论坛帖子
     */
    toggleLikeInDetail(postId) {
        const post = this.forumPosts.find(p => p.id === postId);
        if (!post) return;

        // 防御性初始化 - 问题3修复
        if (!Array.isArray(post.likedBy)) post.likedBy = [];

        // 获取当前用户昵称
        const mammySettings = JSON.parse(localStorage.getItem('mammySettings') || '{}');
        const currentUserNickname = mammySettings.nickname || '我';

        const likeIndex = post.likedBy.indexOf(currentUserNickname);

        if (likeIndex > -1) {
            // 取消点赞
            post.likedBy.splice(likeIndex, 1);
            post.isLiked = false;
        } else {
            // 点赞
            post.likedBy.push(currentUserNickname);
            post.isLiked = true;
        }
        // 确保点赞数与数组长度一致 - 问题3修复
        post.likes = post.likedBy.length;

        // 保存到localStorage
        localStorage.setItem('forumData', JSON.stringify(this.forumPosts));

        // 重新渲染详情页和论坛列表
        this.openPostDetail(postId);
        this.renderForum();
    }

    /**
     * 点赞/取消点赞论坛帖子（列表页）
     */
    toggleForumLike(postId) {
        const post = this.forumPosts.find(p => p.id === postId);
        if (!post) return;

        // 防御性初始化 - 问题3修复
        if (!Array.isArray(post.likedBy)) post.likedBy = [];

        // 获取当前用户昵称
        const mammySettings = JSON.parse(localStorage.getItem('mammySettings') || '{}');
        const currentUserNickname = mammySettings.nickname || '我';

        const likeIndex = post.likedBy.indexOf(currentUserNickname);

        if (likeIndex > -1) {
            // 取消点赞
            post.likedBy.splice(likeIndex, 1);
            post.isLiked = false;
        } else {
            // 点赞
            post.likedBy.push(currentUserNickname);
            post.isLiked = true;
        }
        // 确保点赞数与数组长度一致 - 问题3修复
        post.likes = post.likedBy.length;

        // 保存到localStorage
        localStorage.setItem('forumData', JSON.stringify(this.forumPosts));

        // 重新渲染论坛列表
        this.renderForum();
    }

    /**
     * 显示评论弹窗
     */
    showCommentModal(postId) {
        const modal = document.getElementById('comment-modal');
        if (!modal) return;

        const post = this.forumPosts.find(p => p.id === postId);
        if (!post) return;

        // 保存当前评论的帖子ID
        this.currentCommentPostId = postId;

        // 隐藏身份选择区域（用户直接评论）
        const authorGroup = document.getElementById('comment-author-group');
        if (authorGroup) {
            authorGroup.style.display = 'none';
        }

        // 清空输入框
        document.getElementById('comment-content-input').value = '';

        // 显示评论列表预览
        const commentListPreview = document.getElementById('comment-list-preview');
        const comments = Array.isArray(post.comments) ? post.comments : [];
        if (comments.length > 0) {
            commentListPreview.innerHTML = `
                <div class="comment-section">
                    <h4>评论列表</h4>
                    ${comments.map(comment => this.renderCommentItem(comment)).join('')}
                </div>
            `;
        } else {
            commentListPreview.innerHTML = '<p style="text-align: center; color: #999;">暂无评论</p>';
        }

        modal.classList.add('active');
    }

    /**
     * 关闭评论弹窗
     */
    closeCommentModal() {
        const modal = document.getElementById('comment-modal');
        if (modal) {
            modal.classList.remove('active');
        }
        this.currentCommentPostId = null;
    }

    /**
     * 提交评论
     */
    submitComment() {
        const postId = this.currentCommentPostId;
        if (!postId) return;

        const post = this.forumPosts.find(p => p.id === postId);
        if (!post) return;

        const content = document.getElementById('comment-content-input').value.trim();
        if (!content) {
            this.showNotification('请输入评论内容！');
            return;
        }

        // 固定 authorId 为 'user_mummy'
        const authorId = 'user_mummy';

        const newComment = {
            id: Date.now(),
            authorId: authorId,
            content: content,
            time: this.getRelativeTime(new Date()),
            timestamp: new Date().toISOString()
        };

        // 添加到评论数组
        if (!post.comments) post.comments = [];
        post.comments.unshift(newComment);

        // 更新帖子评论数
        post.commentsCount = post.comments.length;

        // 保存到localStorage
        localStorage.setItem('forumData', JSON.stringify(this.forumPosts));

        // 重新渲染论坛列表
        this.renderForum();

        // 关闭弹窗
        this.closeCommentModal();

        // 触发被@角色的回复
        this.triggerMentionedReply(postId, content);

        // 自动生成AI回复
        this.generateAutoComments(postId);
    }

    /**
     * 生成评论的点赞/踩数据
     */
    generateCommentReactions(commentContent) {
        const hasPositive = /支持|好|棒|赞|喜欢|磕|甜|写得好|说得好|优秀|精彩|不错|给力|加油/i.test(commentContent);
        const hasNegative = /不好|差|无聊|反对|怼|杠|就这|无语|讨厌|失望|垃圾|离谱|气死|无语/i.test(commentContent);

        let likeCount, dislikeCount;
        if (hasPositive) {
            likeCount = Math.floor(Math.random() * 4) + 1;  // 1-4 赞
            dislikeCount = Math.random() < 0.2 ? 1 : 0;    // 20% 概率 1 踩
        } else if (hasNegative) {
            likeCount = Math.floor(Math.random() * 2) + 1;  // 1-2 赞
            dislikeCount = Math.floor(Math.random() * 3);    // 0-2 踩
        } else {
            likeCount = Math.floor(Math.random() * 3);      // 0-2 赞
            dislikeCount = Math.random() < 0.3 ? 1 : 0;     // 30% 概率 1 踩
        }

        return {
            likes: likeCount,
            dislikes: dislikeCount,
            likedBy: Array(likeCount).fill('路人网友'),
            dislikedBy: Array(dislikeCount).fill('路人网友')
        };
    }

    /**
     * 渲染评论项（支持嵌套）
     */
    renderCommentItem(comment, level = 0) {
        const authorChat = this.getChat(comment.authorId);
        let authorName = '匿名';
        let authorAvatar = '👤';

        if (authorChat) {
            authorName = authorChat.nickname || authorChat.name;
            authorAvatar = authorChat.avatar || '👤';
        } else if (comment.authorId.startsWith('npc_')) {
            // 查找NPC
            const npcName = comment.authorId.replace('npc_', '');
            authorName = npcName;
        } else {
            // 随机NPC
            const randomNPC = this.randomNPCs.find(npc => npc.id === comment.authorId);
            if (randomNPC) {
                authorName = randomNPC.name;
                authorAvatar = randomNPC.avatar;
            }
        }

        const isReply = comment.parentId !== null;
        const marginLeft = isReply ? '20px' : '0';

        return `
            <div class="comment-item" style="margin-left: ${marginLeft}; background: ${isReply ? '#e9ecef' : '#f8f9fa'}">
                <div class="comment-author-avatar">${authorAvatar}</div>
                <div class="comment-content-wrapper">
                    <span class="comment-author-name">${authorName}:</span>
                    <div class="comment-text">
                        ${(comment.likes || 0) >= 5 ? '<span class="hot-comment-badge">🔥热评</span>' : ''}
                        ${comment.content}
                    </div>
                    <div class="comment-reactions">
                        <span class="reaction-like clickable" onclick="chatManager.toggleCommentReaction(${comment.id}, 'like')">👍 <span class="like-count">${comment.likes || 0}</span></span>
                        <span class="reaction-dislike clickable" onclick="chatManager.toggleCommentReaction(${comment.id}, 'dislike')">👎 <span class="dislike-count">${comment.dislikes || 0}</span></span>
                    </div>
                    <button class="reply-btn" onclick="chatManager.replyToComment(${comment.id})">回复</button>
                </div>
                <div class="comment-time">${comment.time}</div>
            </div>
        `;
    }

    /**
     * 将评论列表转换为树形结构
     */
    getCommentTree(comments) {
        if (!Array.isArray(comments) || comments.length === 0) return [];

        // 建立id到评论的映射
        const commentMap = {};
        comments.forEach(comment => {
            commentMap[comment.id] = comment;
            comment.replies = [];
        });

        // 构建树形结构
        const tree = [];
        comments.forEach(comment => {
            if (comment.parentId && commentMap[comment.parentId]) {
                // 是回复，添加到父评论的replies中
                commentMap[comment.parentId].replies.push(comment);
            } else {
                // 是一级评论
                tree.push(comment);
            }
        });

        return tree;
    }

    /**
     * 递归渲染评论树
     */
    renderCommentTree(comment, level = 0) {
        let html = this.renderCommentItem(comment, level);
        if (comment.replies && comment.replies.length > 0) {
            comment.replies.forEach(reply => {
                html += this.renderCommentTree(reply, level + 1);
            });
        }
        return html;
    }

    /**
     * 刷新当前帖子的评论（追加新评论）
     */
    refreshCommentsForCurrentPost() {
        const postId = this.currentDetailPostId;
        if (!postId) return;
        const post = this.forumPosts.find(p => p.id === postId);
        if (!post) return;
        // 生成1-3条新评论
        const commentCount = Math.floor(Math.random() * 3) + 1;
        const identities = this.getAllIdentities();
        const templates = [
            '支持！', '说得很好！', '有道理', '赞同', '确实如此',
            '我也这么觉得', '说得太对了', '完全支持', '很棒！'
        ];
        for (let i = 0; i < commentCount; i++) {
            const randomIdentity = identities[Math.floor(Math.random() * identities.length)];
            const content = templates[Math.floor(Math.random() * templates.length)];
            const newComment = {
                id: Date.now() + i,
                authorId: randomIdentity.id,
                content: content,
                time: this.getRelativeTime(new Date()),
                timestamp: new Date().toISOString(),
                isAuto: true
            };
            if (!post.comments) post.comments = [];
            post.comments.push(newComment);
        }
        post.commentsCount = post.comments.length;
        localStorage.setItem('forumData', JSON.stringify(this.forumPosts));
        this.renderForum();
        this.openPostDetail(postId);
    }

    /**
     * 转发论坛帖子 - 问题5、问题6修复
     */
    shareForumPost(postId) {
        const post = this.forumPosts.find(p => p.id === postId);
        if (!post) return;

        // 获取作者信息
        const authorChat = this.getChat(post.authorId);
        let authorName = '匿名网友';
        if (authorChat) {
            authorName = authorChat.nickname || authorChat.remarkName || authorChat.name;
        }

        // 获取所有联系人（单聊和群聊，排除妈咪）
        const contacts = this.contacts.filter(contact => contact.id !== 'user_mummy');
        if (contacts.length === 0) {
            this.showNotification('暂无联系人，无法转发！');
            return;
        }

        // 移除已存在的转发模态框
        const existingModal = document.getElementById('share-forum-modal');
        if (existingModal) {
            existingModal.remove();
        }

        // 创建转发选择模态框 - 问题5修复：使用白色模态框替代prompt
        const modalHtml = `
            <div class="modal" id="share-forum-modal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>转发帖子</h3>
                        <button class="close-btn" onclick="document.getElementById('share-forum-modal').remove()">&times;</button>
                    </div>
                    <div class="modal-body">
                        <p>选择转发对象：</p>
                        <div class="contact-list" style="max-height: 300px; overflow-y: auto; margin: 10px 0;">
                            ${contacts.map((contact, index) => {
                                const chat = this.getChat(contact.id);
                                const displayName = chat ? (chat.nickname || chat.remarkName || chat.name) : contact.name;
                                const avatar = chat ? (chat.avatar || '👤') : contact.avatar || '👤';
                                return `
                                    <div class="contact-item" data-contact-id="${contact.id}" style="display: flex; align-items: center; padding: 8px; cursor: pointer; border-radius: 6px; margin: 4px 0; transition: background 0.15s;">
                                        <div style="width: 36px; height: 36px; border-radius: 50%; background: var(--nav-active-bg); display: flex; align-items: center; justify-content: center; margin-right: 10px; font-size: 18px;">${avatar}</div>
                                        <span>${displayName}</span>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="cancel-btn" onclick="document.getElementById('share-forum-modal').remove()">取消</button>
                        <button class="submit-btn" id="confirm-forward-btn" disabled>转发</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        const modal = document.getElementById('share-forum-modal');

        // 绑定联系人选择事件
        let selectedContactId = null;
        modal.querySelectorAll('.contact-item').forEach(item => {
            item.addEventListener('click', () => {
                modal.querySelectorAll('.contact-item').forEach(ci => ci.style.background = '');
                item.style.background = 'var(--nav-active)';
                selectedContactId = item.getAttribute('data-contact-id');
                modal.querySelector('#confirm-forward-btn').disabled = false;
            });
        });

        // 绑定转发按钮事件
        modal.querySelector('#confirm-forward-btn').addEventListener('click', () => {
            if (selectedContactId) {
                this.forwardToContact(selectedContactId, post, authorName);
                modal.remove();
            }
        });

        modal.classList.add('active');
    }

    /**
     * 转发帖子给指定联系人
     */
    forwardToContact(contactId, post, authorName) {
        const targetChat = this.getChat(contactId);
        if (!targetChat) return;

        // 构造卡片消息
        const cardMsg = {
            type: 'post_card',
            postId: post.id,
            title: post.title,
            authorName: authorName,
            preview: post.content.substring(0, 100),
            imageUrl: post.imageUrl || null,
            timestamp: new Date().toISOString(),
            text: `分享了帖子：${post.content.substring(0, 50)}...`, // 用于显示在聊天列表
            isMe: true
        };

        // 添加到目标聊天的消息数组
        if (!targetChat.messages) targetChat.messages = [];
        targetChat.messages.push(cardMsg);

        // 更新最后消息
        targetChat.lastMessage = cardMsg.text;
        targetChat.lastTime = this.getRelativeTime(new Date());
        targetChat.lastTimestamp = new Date().toISOString();

        // 保存到localStorage
        this.saveChats();

        // 重新渲染聊天列表
        this.renderChatList();

        // 如果当前正在查看目标聊天，重新渲染消息
        if (this.currentChat && this.currentChat.id === contactId) {
            this.renderMessages(targetChat);
            this.scrollToBottom();
        }

        const contact = this.contacts.find(c => c.id === contactId);
        const chat = this.getChat(contactId);
        const displayName = chat ? (chat.nickname || chat.remarkName || chat.name) : (contact ? contact.name : contactId);
        this.showNotification(`已转发给: ${displayName}`);

        // ===== 新增部分开始 =====
        if (targetChat && !targetChat.isGroup) {
            const prompt = `我刚刚分享了一篇论坛帖子给你，这是帖子的完整内容：

【标题】${post.title}
【作者】${authorName}
【正文】
${post.content}

请你以你的角色身份，仔细阅读后发表看法。你可以：
- 评价帖子内容本身的趣味或槽点
- 调侃或吐槽作者的想法
- 结合自己的经历或世界观谈谈感想
- 回复要自然，可以说一两句话，也可以多说几句，不要过于简短
请务必用纯文本回复，不要在句子外加括号或动作描写，结尾加上情绪标签 [emotion:xxx]。`;
            try {
                this.callAI(contactId, prompt).then(reply => {
                    if (reply) {
                        this.addMessageWithEmotion(contactId, reply);
                    }
                }).catch(err => {
                    console.error('分享帖子AI回复失败:', err);
                });
            } catch(e) {
                console.error('分享帖子AI调用异常:', e);
            }
        }
        // ===== 新增部分结束 =====
    }

    /**
     * 触发被@角色的回复
     */
    triggerMentionedReply(postId, commentContent) {
        // 简单关键词匹配
        const keywords = ['薛厉', '明日', '狼羊', '汪明日', '封烬', '芬里斯'];
        const mentionedKeyword = keywords.find(keyword => commentContent.includes(keyword));

        if (mentionedKeyword) {
            // 直接调用generateNPCReplyForKeyword，不再使用随机概率
            setTimeout(() => {
                this.generateNPCReplyForKeyword(postId, mentionedKeyword);
            }, 2000); // 2秒后回复
        }
    }

    /**
     * 为帖子生成自动回复
     */
    generateAutoReplyForPost(postId, keyword) {
        const post = this.forumPosts.find(p => p.id === postId);
        if (!post || !post.comments) return;

        // 根据关键词选择合适的角色
        let replyAuthorId = 'user_mummy'; // 默认妈咪
        if (keyword === '薛厉' || keyword === '封烬') {
            replyAuthorId = 'user_xueli';
        } else if (keyword === '明日' || keyword === '汪明日') {
            replyAuthorId = 'user_wangmingri';
        } else if (keyword === '狼羊') {
            replyAuthorId = 'group_langyang';
        } else if (keyword === '芬里斯') {
            replyAuthorId = 'user_feilisi';
        }

        // 生成回复内容
        const replies = {
            '薛厉': ['说得对', '有道理', '确实如此', '我也这么觉得'],
            '明日': ['嗯嗯', '没错', '赞同', '支持'],
            '狼羊': ['狼羊组万岁！', '支持狼羊组', '狼羊组最棒'],
            '封烬': ['封烬大佬', '说得很好', '有见地'],
            '芬里斯': ['芬里斯说得对', '赞同'],
            '汪明日': ['明日哥说得对', '支持明日哥']
        };

        const replyContent = replies[keyword] ? replies[keyword][Math.floor(Math.random() * replies[keyword].length)] : '说得好！';

        const autoComment = {
            id: Date.now(),
            authorId: replyAuthorId,
            content: `@${keyword} ${replyContent}`,
            time: this.getRelativeTime(new Date()),
            timestamp: new Date().toISOString(),
            isAuto: true
        };

        post.comments.push(autoComment);
        localStorage.setItem('forumData', JSON.stringify(this.forumPosts));
        this.renderForum();
    }

    /**
     * 为帖子自动生成评论
     */
    generateAutoComments(postId) {
        const post = this.forumPosts.find(p => p.id === postId);
        if (!post) return;

        // 根据帖子内容关键词决定生成多少评论
        let commentCount = 0;
        if (post.content.includes('薛厉') || post.content.includes('明日')) {
            commentCount = Math.floor(Math.random() * 3) + 2; // 2-4条评论
        } else if (post.content.includes('狼羊') || post.content.includes('组')) {
            commentCount = Math.floor(Math.random() * 2) + 1; // 1-2条评论
        }

        if (commentCount === 0) return;

        // 生成评论
        const identities = this.getAllIdentities();
        const delay = 1000; // 1秒后开始生成

        setTimeout(() => {
            for (let i = 0; i < commentCount; i++) {
                setTimeout(() => {
                    let randomIdentity = identities[Math.floor(Math.random() * identities.length)];
                    // 如果随机到妈咪身份，则跳过这次循环
                    if (randomIdentity.id === 'user_mummy') {
                        return; // 跳过本次循环的后续逻辑
                    }
                    const templates = [
                        '支持！', '说得很好！', '有道理', '赞同', '确实如此',
                        '我也这么觉得', '说得太对了', '完全支持', '很棒！'
                    ];
                    const content = templates[Math.floor(Math.random() * templates.length)];

                    const autoComment = {
                        id: Date.now() + i,
                        authorId: randomIdentity.id,
                        content: content,
                        time: this.getRelativeTime(new Date()),
                        timestamp: new Date().toISOString(),
                        isAuto: true
                    };

                    if (!post.comments) post.comments = [];
                    post.comments.push(autoComment);
                    localStorage.setItem('forumData', JSON.stringify(this.forumPosts));
                    this.renderForum();
                }, i * 500); // 每条评论间隔0.5秒
            }
        }, delay);
    }

    renderDynamics(append = false) {
        const dynamicListEl = document.getElementById('dynamic-list');
        if (!dynamicListEl) return;

        // 如果是首次加载（非追加），重置分页状态
        if (!append) {
            this.dynamicPage = 1;
            this.dynamicHasMore = true;
            dynamicListEl.innerHTML = ''; // 清空容器
        }

        // 获取当前页的数据
        const dynamicsToRender = this.getPaginatedDynamics(this.dynamicPage, this.dynamicPageSize);

        // 如果没有更多数据了，标记并显示提示
        if (dynamicsToRender.length < this.dynamicPageSize) {
            this.dynamicHasMore = false;
        }

        // 如果是追加模式，将新内容添加到现有内容后面
        const newContent = dynamicsToRender.map(dynamic => {
            // 通过 authorId 获取正确的显示名称
            const authorChat = this.getChat(dynamic.authorId);
            const displayAuthor = this.getDynamicDisplayName(authorChat);
            // 判断头像是否为URL
            const avatar = dynamic.avatar;
            let avatarHtml;
            if (avatar && typeof avatar === 'string' && (avatar.startsWith('http://') || avatar.startsWith('https://'))) {
                avatarHtml = `<img src="${avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
            } else {
                avatarHtml = `<span>${avatar || '👤'}</span>`;
            }
            const likeClass = dynamic.isLiked ? 'liked' : '';
            const nicknameClass = dynamic.isMe ? 'my-dynamic' : 'oc-dynamic';

            // 渲染评论 - 显示所有评论，区分回复关系
            const commentsHtml = dynamic.comments && dynamic.comments.length > 0 ?
                dynamic.comments.map(comment => {
                    const replyText = comment.replyTo && comment.replyTo.trim() ? ` 回复 @${comment.replyTo}` : '';
                    return `<div class="comment-item" data-comment-id="${comment.id}" data-dynamic-id="${dynamic.id}" data-author-id="${comment.authorId}" data-author-name="${comment.authorName}"><span class="comment-text"><span class="comment-author">${comment.authorName}</span>${replyText}：${comment.content}</span><span class="comment-menu-btn" onclick="chatManager.showCommentMenu(event, '${dynamic.id}', '${comment.id}')">⋯</span></div>`;
                }).join('') : '';

            // 点赞人显示（增加防御判断）
            const likedBy = dynamic.likedBy || [];
            const likesHtml = likedBy.length > 0 ?
                `<div class="dynamic-likes has-likes">❤️ ${likedBy.join('、')}</div>` : '';

            // 根据类型渲染内容
            let contentHtml = '';
            switch (dynamic.type) {
                case 'text':
                    contentHtml = `<div class="dynamic-content">${dynamic.content}</div>`;
                    break;
                case 'image':
                    contentHtml = `
                        <div class="dynamic-card-media image-card">
                            <div class="card-icon">🖼️</div>
                            <div class="card-content">${dynamic.content}</div>
                        </div>
                    `;
                    break;
                case 'video':
                    contentHtml = `
                        <div class="dynamic-card-media video-card">
                            <div class="card-icon">🎬</div>
                            <div class="card-content">${dynamic.content}</div>
                        </div>
                    `;
                    break;
                case 'music':
                    const music = dynamic.musicData || { name: '未知歌曲', artist: '未知歌手' };
                    contentHtml = `
                        <div class="dynamic-music-card">
                            <div class="music-main-row">
                                <div class="music-mini-vinyl">
                                    <div class="mini-vinyl-disc"></div>
                                </div>
                                <div class="music-info">
                                    <div class="music-title">${this.escapeHtml(music.name)}</div>
                                    <div class="music-artist">${this.escapeHtml(music.artist)}</div>
                                </div>
                            </div>
                            <div class="music-share-note">${this.escapeHtml(dynamic.content || '分享一首歌')}</div>
                        </div>
                    `;
                    break;
                case 'mood':
                    const mood = dynamic.moodData || { emoji: '😊', mood: '平静', note: '' };
                    contentHtml = `
                        <div class="dynamic-mood-card">
                            <span class="mood-emoji-badge">${mood.emoji}</span>
                            <span class="mood-text-badge">${this.escapeHtml(mood.mood)}</span>
                            <div class="mood-note-preview">${this.escapeHtml(mood.note)}</div>
                            <div class="mood-share-note">${this.escapeHtml(dynamic.content || '')}</div>
                        </div>
                    `;
                    break;
                case 'task':
                    const task = dynamic.taskData || { total: 0, completed: 0 };
                    const percent = task.total > 0 ? Math.round((task.completed / task.total) * 100) : 0;
                    contentHtml = `
                        <div class="dynamic-task-card">
                            <div class="task-header">
                                <span class="task-icon">✅</span>
                                <span class="task-title">今日任务</span>
                                <span class="task-count">${task.completed}/${task.total}</span>
                            </div>
                            <div class="task-progress-mini">
                                <div class="progress-fill" style="width: ${percent}%;"></div>
                            </div>
                            <div class="task-share-note">${this.escapeHtml(dynamic.content || '')}</div>
                        </div>
                    `;
                    break;
                default:
                    contentHtml = `<div class="dynamic-content">${dynamic.content}</div>`;
            }

            return `
                <div class="dynamic-card ${nicknameClass}" data-dynamic-id="${dynamic.id}">
                    <div class="dynamic-card-header">
                        <div class="dynamic-avatar">${avatarHtml}</div>
                        <div class="dynamic-user-info">
                            <div class="dynamic-nickname">${displayAuthor}</div>
                        </div>
                    </div>
                    ${contentHtml}

                    <!-- 底部信息行：时间 + 操作按钮 -->
                    <div class="dynamic-footer">
                        <span class="dynamic-time">${dynamic.time}</span>
                        <button class="dynamic-more-btn" onclick="chatManager.showDynamicMenu(${dynamic.id}, event)">⋯</button>
                    </div>

                    <!-- 点赞人列表显示区域 -->
                    ${likesHtml}

                    <!-- 评论区 -->
                    <div class="dynamic-comments" id="comments-${dynamic.id}">
                        ${commentsHtml}
                        <div class="comment-input-area" id="comment-input-${dynamic.id}" style="display: none;">
                            <input type="text" class="comment-input" id="comment-input-field-${dynamic.id}" placeholder="发表评论..." onkeypress="chatManager.handleCommentKeyPress(${dynamic.id}, event)">
                            <button class="comment-send-btn" onclick="chatManager.handleSendCommentClick(${dynamic.id}, this)">发送</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // 将新内容添加到容器中（追加或替换）
        if (append) {
            dynamicListEl.insertAdjacentHTML('beforeend', newContent);
            // 追加加载指示器（先移除旧的）
            const oldIndicator = dynamicListEl.querySelector('.loading-indicator');
            if (oldIndicator) oldIndicator.remove();
            if (this.dynamicHasMore) {
                const indicator = document.createElement('div');
                indicator.className = 'loading-indicator';
                indicator.innerHTML = '<span>加载中</span><span class="loading-dot"></span><span class="loading-dot"></span><span class="loading-dot"></span>';
                dynamicListEl.appendChild(indicator);
            }
        } else {
            dynamicListEl.innerHTML = newContent;
        }

        // 如果首次加载后内容还没填满容器，自动加载更多
        if (!append) {
            this._checkAndFillContainer('dynamic-list', 'dynamic');
        }

        // 为动态列表添加评论点击事件委托
        this.setupCommentClickListeners();
    }

    /**
     * 设置评论点击事件监听
     */
    setupCommentClickListeners() {
        const dynamicListEl = document.getElementById('dynamic-list');
        if (!dynamicListEl) return;

        // 使用事件委托监听评论点击
        dynamicListEl.addEventListener('click', (event) => {
            const commentItem = event.target.closest('.comment-item');
            if (!commentItem) return;

            // 获取评论信息
            const commentId = commentItem.dataset.commentId;
            const authorId = commentItem.dataset.authorId;
            const authorName = commentItem.dataset.authorName;
            const commentText = commentItem.textContent.split('：')[1] || '';

            // 获取动态ID
            const dynamicCard = commentItem.closest('.dynamic-card');
            const dynamicId = dynamicCard?.dataset.dynamicId;

            if (!dynamicId) return;

            // 显示回复输入框
            this.showReplyInput(dynamicId, {
                id: commentId,
                authorId: authorId,
                authorName: authorName,
                content: commentText
            });
        });
    }

    /**
     * 显示回复输入框
     */
    showReplyInput(dynamicId, comment) {
        const commentInputArea = document.getElementById(`comment-input-${dynamicId}`);
        const commentInputField = document.getElementById(`comment-input-field-${dynamicId}`);

        if (!commentInputArea || !commentInputField) return;

        // 从 data-author-name 属性获取正确的作者名
        const commentElement = document.querySelector(`.comment-item[data-comment-id="${comment.id}"]`);
        const authorName = commentElement ? commentElement.dataset.authorName : (comment.authorName || '未知用户');

        // 显示输入框
        commentInputArea.style.display = 'flex';
        commentInputField.placeholder = `回复 @${authorName}`;

        // 存储回复信息（使用安全的数据结构，避免 authorName 包含 HTML 标签导致序列化问题）
        const safeReplyTo = {
            authorId: comment.authorId,
            authorName: authorName.split(' 回复')[0], // 去掉可能包含的回复HTML标签
            content: comment.content
        };
        commentInputArea.dataset.replyTo = JSON.stringify(safeReplyTo);

        // 聚焦输入框
        commentInputField.focus();
    }

    /**
     * 添加回复评论
     */
    addReply(dynamicId, replyToComment) {
        const inputField = document.getElementById(`comment-input-field-${dynamicId}`);
        const content = inputField?.value.trim();

        if (!content) {
            this.showNotification('请输入回复内容！');
            return;
        }

        const dynamic = this.dynamics.find(d => d.id === dynamicId);
        if (!dynamic) return;

        // 防御性处理 authorName
        const authorName = replyToComment.authorName || '未知用户';

        // 创建回复评论
        const replyComment = {
            id: 'cmt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            authorId: 'user_mummy',
            authorName: this.mammySettings?.nickname || '我',
            content: content,
            timestamp: Date.now(),
            replyTo: authorName
        };

        // 添加到评论数组
        if (!dynamic.comments) dynamic.comments = [];
        dynamic.comments.push(replyComment);

        // 保存并重新渲染
        this.saveDynamics();
        this.renderDynamics();

        // 触发被回复者回应
        // 传入 replyComment（妈咪的回复）作为 AI 回复目标，replyToComment 用于确定哪个 AI 角色需要回复
        this.triggerReplyToMummy(dynamic, replyComment, replyToComment);

        // 清空输入框
        if (inputField) {
            inputField.value = '';
            inputField.placeholder = '发表评论...';
        }

        console.log(`回复 ${replyToComment.authorName}: ${content}`);
    }

    /**
     * 处理评论输入框回车事件
     */
    handleCommentKeyPress(dynamicId, event) {
        if (event.key === 'Enter') {
            const commentInputArea = document.getElementById(`comment-input-${dynamicId}`);
            const inputField = document.getElementById(`comment-input-field-${dynamicId}`);

            // 检查是否有回复目标
            const replyToData = commentInputArea.dataset.replyTo;
            if (replyToData) {
                // 是回复
                const replyToComment = JSON.parse(replyToData);
                this.addReply(dynamicId, replyToComment);

                // 清除回复状态
                delete commentInputArea.dataset.replyTo;
            } else {
                // 是普通评论
                this.addComment(dynamicId);
            }
        }
    }

    toggleLike(type, id) {
        let items = type === 'forum' ? this.forumPosts : this.dynamics;
        const item = items.find(p => p.id === id);
        if (!item) return;

        // 获取当前用户昵称
        const myName = this.mammySettings?.nickname || '我';

        // 初始化 likedBy 数组（如果不存在）
        if (!item.likedBy) item.likedBy = [];

        if (type === 'dynamic') {
            if (item.isLiked) {
                // 取消点赞
                item.likes = Math.max(0, item.likes - 1);
                item.likedBy = item.likedBy.filter(name => name !== myName);
                item.isLiked = false;
            } else {
                // 点赞
                item.likes += 1;
                if (!item.likedBy.includes(myName)) item.likedBy.push(myName);
                item.isLiked = true;
            }

            // 保存数据
            this.saveDynamics();

            // 重新渲染整个动态列表以确保点赞状态正确显示
            this.renderDynamics();
        } else if (type === 'forum') {
            item.isLiked = !item.isLiked;
            item.likes += item.isLiked ? 1 : -1;
            this.renderForum();
        }
    }

    deleteDynamic(dynamicId) {
        const modal = document.getElementById('confirm-modal');
        const title = document.getElementById('confirm-modal-title');
        const message = document.getElementById('confirm-modal-message');
        const confirmBtn = document.getElementById('confirm-confirm-btn');
        const cancelBtn = document.getElementById('confirm-cancel-btn');

        if (!modal || !title || !message) return;

        title.textContent = '删除动态';
        message.textContent = '确定要删除这条动态吗？';
        modal.classList.add('active');

        const onConfirm = () => {
            const index = this.dynamics.findIndex(d => d.id == dynamicId);
            if (index !== -1) {
                this.dynamics.splice(index, 1);
                this.saveDynamics();
                // 重置动态分页并刷新
                this.renderDynamics(false);
                this.showNotification('动态已删除');
            }
            modal.classList.remove('active');
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
        };

        const onCancel = () => {
            modal.classList.remove('active');
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
        };

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
    }

    commentPost(type, id) {
        this.showNotification('评论功能开发中，敬请期待！');
    }

    shareDynamic(id) {
        this.showDynamicForwardModal(id);
    }

    /**
     * 撤回消息
     */
    revokeMessage(msgIdx) {
        if (!this.currentChat || msgIdx < 0 || msgIdx >= this.currentChat.messages.length) {
            this.showNotification('消息不存在');
            return;
        }

        const message = this.currentChat.messages[msgIdx];
        // 仅允许撤回自己发送的普通文本消息
        // 禁止撤回：系统消息、拍一拍、转账、红包（包括领取）、语音、图片、视频、转发卡片等
        if (!message.isMe || message.isSystem || message.type === 'pat' ||
            ['voice', 'image', 'video', 'forward_card', 'transfer', 'redpacket', 'redpacket_grab'].includes(message.type)) {
            this.showNotification('无法撤回此类型消息');
            return;
        }

        // 从消息数组中删除
        this.currentChat.messages.splice(msgIdx, 1);

        // 更新最后消息
        if (this.currentChat.messages.length > 0) {
            const lastMsg = this.currentChat.messages[this.currentChat.messages.length - 1];
            this.currentChat.lastMessage = lastMsg.text || lastMsg.content || '...';
            this.currentChat.lastTimestamp = lastMsg.timestamp;
        } else {
            this.currentChat.lastMessage = '';
            this.currentChat.lastTimestamp = null;
        }
        this.currentChat.lastTime = this.getRelativeTime(new Date());

        // 保存并重新渲染
        this.saveChats();
        this.renderMessages(this.currentChat);
        this.renderChatList();

        // 显示系统提示
        const sysMsg = {
            text: '你撤回了一条消息',
            timestamp: new Date().toISOString(),
            isMe: true,
            isSystem: true
        };
        this.currentChat.messages.push(sysMsg);
        this.saveChats();
        this.renderMessages(this.currentChat);

        this.showNotification('消息已撤回');
    }

    /**
     * 显示单条消息转发选择器
     */
    showForwardSelectorForSingleMessage(message) {
        // 获取所有聊天（排除自己和妈咪），参考多选转发的目标筛选逻辑
        const targetChats = this.contacts.filter(contact => {
            const isSelf = (contact.id === this.currentChat?.id);
            const isMummy = (contact.id === 'user_mummy');
            return !isSelf && !isMummy;
        }).map(contact => {
            // 获取对应的聊天对象（用于显示备注名等）
            const chat = this.getChat(contact.id);
            return {
                id: contact.id,
                name: chat ? (chat.remarkName || chat.nickname || chat.name) : contact.name,
                avatar: chat ? chat.avatar : contact.avatar
            };
        });
        if (targetChats.length === 0) {
            this.showNotification('没有可转发的聊天');
            return;
        }

        // 创建模态框
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>转发消息</h3>
                    <button class="close-btn">✕</button>
                </div>
                <div class="modal-body">
                    <div class="forward-contact-list" id="forward-contact-list">
                        ${targetChats.map(chat => `
                            <div class="forward-contact-item" data-chat-id="${chat.id}">
                                <div class="forward-avatar">${chat.avatar || '👤'}</div>
                                <span class="forward-name">${chat.name}</span>
                                ${chat.unreadCount ? `<span class="forward-badge">${chat.unreadCount}</span>` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="cancel-btn">取消</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // 绑定选择事件
        const items = modal.querySelectorAll('.forward-contact-item');
        let selectedChatId = null;
        items.forEach(item => {
            item.addEventListener('click', () => {
                items.forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');
                selectedChatId = item.dataset.chatId;
            });
        });

        // 绑定确认转发
        const confirmBtn = modal.querySelector('.submit-btn');
        if (!confirmBtn) {
            const footer = modal.querySelector('.modal-footer');
            const confirmBtnEl = document.createElement('button');
            confirmBtnEl.className = 'submit-btn';
            confirmBtnEl.textContent = '转发';
            footer.appendChild(confirmBtnEl);
        }

        modal.querySelector('.submit-btn').onclick = () => {
            if (selectedChatId) {
                this.forwardMessageToChat(message, selectedChatId);
                modal.remove();
            } else {
                this.showNotification('请选择一个聊天');
            }
        };

        // 绑定取消
        modal.querySelector('.cancel-btn').onclick = () => modal.remove();
        modal.querySelector('.close-btn').onclick = () => modal.remove();
    }

    forwardMessageToChat(message, targetChatId) {
        const targetChat = this.getChat(targetChatId);
        if (!targetChat) {
            this.showNotification('目标聊天不存在');
            return;
        }

        // 创建转发消息
        const senderName = message.isMe ? '我' : (this.currentChat?.name || '对方');
        const originalChatName = this.getDisplayName(this.currentChat);
        const cardTitle = `${senderName} 和 ${originalChatName} 的聊天记录`;

        // 使用 getMessagePlainText 获取带类型标注的内容
        const plainText = this.getMessagePlainText(message);
        const cardPreview = plainText.length > 100 ? plainText.substring(0, 100) + '...' : plainText;

        const forwardCard = {
            type: 'forward_card',
            isMe: true,
            title: cardTitle,
            preview: cardPreview,
            fullContent: plainText,
            messageCount: 1,
            originalChatId: this.currentChat?.id,
            timestamp: new Date().toISOString(),
            originalSender: senderName,
            originalContent: message.text || message.content || '',
            cardPreview: cardPreview,
            cardType: message.type || 'text',
            text: `转发了${this.getMessageTypeText(message.type)}：${cardPreview.substring(0, 50)}${cardPreview.length > 50 ? '...' : ''}`
        };

        targetChat.messages.push(forwardCard);
        targetChat.lastMessage = forwardCard.text;
        targetChat.lastTimestamp = forwardCard.timestamp;
        targetChat.lastTime = this.getRelativeTime(new Date());

        if (!(this.currentChat && this.currentChat.id === targetChatId)) {
            targetChat.unreadCount = (targetChat.unreadCount || 0) + 1;
        }

        this.saveChats();
        this.renderChatList();
        this.updateMessageBadge();

        if (this.currentChat && this.currentChat.id === targetChatId) {
            this.renderMessages(targetChat);
            this.applyBubbleStyle(targetChat);
            this.scrollToBottom();
        }

        this.showNotification(`已转发给 ${targetChat.name}`);
    }

    showMessageActionMenu(message, event) {
        // 多选模式下不显示此菜单
        if (this.multiSelectMode) return;

        event.preventDefault();
        event.stopPropagation();

        // 关闭已存在的菜单
        const existingMenu = document.querySelector('.dynamic-popup-menu');
        if (existingMenu) existingMenu.remove();

        // 创建浮动菜单容器
        const menu = document.createElement('div');
        menu.className = 'dynamic-popup-menu';

        // 菜单项配置
        const menuItems = [
            { label: '复制', icon: '📋', action: 'copy' },
            { label: '引用', icon: '💬', action: 'quote' },
            { label: '多选', icon: '☑️', action: 'multiSelect' },
            { label: '撤回', icon: '↩️', action: 'revoke' },
            { label: '转发', icon: '↗️', action: 'forward' }
        ];

        // 系统消息、拍一拍等隐藏"撤回"和"引用"
        // 注意：转账和红包消息允许转发，所以不在这里过滤
        const isSystemMessage = message.isSystem || message.type === 'pat';
        const filteredItems = isSystemMessage
            ? menuItems.filter(item => item.action !== 'revoke' && item.action !== 'quote')
            : menuItems;

        // 获取消息索引
        const msgIdx = this.currentChat.messages.indexOf(message);
        let senderName;
        if (message.isMe) {
            senderName = '我';
        } else if (message.senderId) {
            const senderChat = this.getChat(message.senderId);
            if (senderChat) {
                senderName = senderChat.remarkName || senderChat.nickname || senderChat.name;
            } else {
                // 可能是 NPC
                const npcInfo = this.getMemberDisplayInfo(message.senderId);
                senderName = npcInfo.name;
            }
        } else {
            // 兼容旧消息或私聊
            senderName = this.currentChat ? (this.currentChat.remarkName || this.currentChat.name) : '对方';
        }

        // 创建菜单项
        filteredItems.forEach(item => {
            const menuItem = document.createElement('div');
            menuItem.className = 'popup-menu-item';
            menuItem.innerHTML = `
                <span class="popup-menu-icon">${item.icon}</span>
                <span class="popup-menu-text">${item.label}</span>
            `;
            menuItem.onclick = (e) => {
                e.stopPropagation();
                menu.remove();

                switch (item.action) {
                    case 'copy':
                        // 复制功能
                        const textToCopy = message.text || message.content || '';
                        if (textToCopy) {
                            navigator.clipboard.writeText(textToCopy).then(() => {
                                this.showNotification('已复制');
                            }).catch(() => {
                                // 降级方案：使用 textarea 复制
                                const textarea = document.createElement('textarea');
                                textarea.value = textToCopy;
                                document.body.appendChild(textarea);
                                textarea.select();
                                document.execCommand('copy');
                                document.body.removeChild(textarea);
                                this.showNotification('已复制');
                            });
                        }
                        break;

                    case 'quote':
                        // 引用功能 - 微信风格
                        const quoteText = message.text || message.content || '';
                        const shortPreview = quoteText.length > 20 ? quoteText.substring(0, 20) + '...' : quoteText;
                        this.quoteMessage = {
                            ...message,
                            senderName: senderName,
                            preview: shortPreview
                        };

                        // 显示引用条
                        this.showQuoteBar();
                        break;

                    case 'multiSelect':
                        // 多选功能
                        this.enterMultiSelectMode(msgIdx);
                        break;

                    case 'revoke':
                        // 撤回功能
                        this.revokeMessage(msgIdx);
                        break;

                    case 'forward':
                        // 转发功能
                        this.showForwardSelectorForSingleMessage(message);
                        break;
                }
            };
            menu.appendChild(menuItem);
        });

        // 定位到鼠标位置
        const x = event.clientX || event.touches?.[0]?.clientX || event.pageX;
        const y = event.clientY || event.touches?.[0]?.clientY || event.pageY;

        menu.style.left = x + 'px';
        menu.style.top = y + 'px';

        document.body.appendChild(menu);

        // 点击其他区域关闭菜单
        const closeHandler = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeHandler);
                document.removeEventListener('touchstart', closeHandler);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', closeHandler);
            document.addEventListener('touchstart', closeHandler);
        }, 10);
    }

    showDynamicMenu(dynamicId, event) {
        event.stopPropagation();

        // 关闭已存在的菜单
        const existingMenu = document.querySelector('.dynamic-popup-menu');
        if (existingMenu) existingMenu.remove();

        const dynamic = this.dynamics.find(d => d.id === dynamicId);
        if (!dynamic) return;

        // 创建浮动菜单容器
        const menu = document.createElement('div');
        menu.className = 'dynamic-popup-menu';

        // 点赞菜单项
        const likeItem = document.createElement('div');
        likeItem.className = 'popup-menu-item';
        likeItem.innerHTML = `
            <span class="popup-menu-icon">${dynamic.isLiked ? '❤️' : '🤍'}</span>
            <span class="popup-menu-text">${dynamic.isLiked ? '取消点赞' : '点赞'}</span>
        `;
        likeItem.onclick = (e) => {
            e.stopPropagation();
            this.toggleLike('dynamic', dynamicId);
            menu.remove();
        };

        // 评论菜单项
        const commentItem = document.createElement('div');
        commentItem.className = 'popup-menu-item';
        commentItem.innerHTML = `
            <span class="popup-menu-icon">💬</span>
            <span class="popup-menu-text">评论</span>
        `;
        commentItem.onclick = (e) => {
            e.stopPropagation();
            this.showCommentInput(dynamicId);
            menu.remove();
        };

        // 转发菜单项
        const forwardItem = document.createElement('div');
        forwardItem.className = 'popup-menu-item';
        forwardItem.innerHTML = `
            <span class="popup-menu-icon">↗️</span>
            <span class="popup-menu-text">转发</span>
        `;
        forwardItem.onclick = (e) => {
            e.stopPropagation();
            this.shareDynamic(dynamicId);
            menu.remove();
        };

        menu.appendChild(likeItem);
        menu.appendChild(commentItem);
        menu.appendChild(forwardItem);

        // 删除菜单项
        const deleteItem = document.createElement('div');
        deleteItem.className = 'popup-menu-item';
        deleteItem.innerHTML = `
            <span class="popup-menu-icon">🗑️</span>
            <span class="popup-menu-text">删除</span>
        `;
        deleteItem.onclick = (e) => {
            e.stopPropagation();
            this.deleteDynamic(dynamicId);
            menu.remove();
        };
        menu.appendChild(deleteItem);

        // 定位到按钮附近
        const btn = event.target.closest('.dynamic-more-btn');
        if (btn) {
            const rect = btn.getBoundingClientRect();
            menu.style.top = (rect.bottom - 5) + 'px';
            menu.style.right = (window.innerWidth - rect.right) + 'px';
        }

        document.body.appendChild(menu);

        // 点击其他区域关闭菜单
        const closeHandler = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 10);
    }

    showDynamicForwardModal(dynamicId) {
        // 获取所有聊天（排除妈咪）
        const targetChats = this.chats.filter(chat => chat.id !== 'user_mummy');
        if (targetChats.length === 0) {
            this.showNotification('没有可转发的聊天');
            return;
        }

        // 创建模态框
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'dynamic-forward-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>选择转发对象</h3>
                    <button class="close-btn" onclick="this.closest('.modal').classList.remove('active')">✕</button>
                </div>
                <div class="modal-body" style="max-height: 60vh; overflow-y: auto;">
                    <div class="forward-contact-list">
                        ${targetChats.map(chat => `
                            <div class="forward-contact-item" data-id="${chat.id}">
                                <div class="forward-avatar">${chat.avatar || '👤'}</div>
                                <div class="forward-name">${chat.name}</div>
                                ${chat.isGroup ? '<span class="forward-badge">群聊</span>' : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="cancel-btn" onclick="this.closest('.modal').classList.remove('active')">取消</button>
                    <button class="submit-btn" id="dynamic-forward-confirm-btn" disabled>确认转发</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.classList.add('active');

        let selectedChatId = null;
        const items = modal.querySelectorAll('.forward-contact-item');
        const confirmBtn = modal.querySelector('#dynamic-forward-confirm-btn');

        items.forEach(item => {
            item.addEventListener('click', () => {
                items.forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');
                selectedChatId = item.dataset.id;
                confirmBtn.disabled = false;
            });
        });

        confirmBtn.onclick = () => {
            if (selectedChatId) {
                this.forwardDynamicToChat(dynamicId, selectedChatId);
                modal.remove();
            } else {
                this.showNotification('请选择一个聊天');
            }
        };
    }

    forwardDynamicToChat(dynamicId, targetChatId) {
        const dynamic = this.dynamics.find(d => d.id == dynamicId);
        if (!dynamic) return;

        const targetChat = this.getChat(targetChatId);
        if (!targetChat) return;

        // 构造动态卡片消息
        const dynamicCard = {
            type: 'dynamic_card',
            dynamicId: dynamic.id,
            authorName: dynamic.author,
            avatar: dynamic.avatar,
            content: dynamic.content,
            image: dynamic.image || null,
            timestamp: new Date().toISOString(),
            text: `分享了 ${dynamic.author} 的动态：${dynamic.content.substring(0, 30)}...`,
            isMe: true
        };

        // 添加到目标聊天
        targetChat.messages.push(dynamicCard);
        targetChat.lastMessage = dynamicCard.text;
        targetChat.lastTimestamp = dynamicCard.timestamp;
        targetChat.lastTime = this.getRelativeTime(new Date());
        if (!(this.currentChat && this.currentChat.id === targetChatId)) {
            targetChat.unreadCount = (targetChat.unreadCount || 0) + 1;
        }

        this.saveChats();
        this.renderChatList();

        // 如果当前正在查看目标聊天，重新渲染
        if (this.currentChat && this.currentChat.id === targetChatId) {
            this.renderMessages(targetChat);
            this.scrollToBottom();
        }

        this.showNotification('转发成功');

        // 如果是单聊，自动触发 AI 回复
        if (!targetChat.isGroup) {
            // 构建评论预览（取前3条）
            let commentsPreview = '';
            if (dynamic.comments && dynamic.comments.length > 0) {
                const topComments = dynamic.comments.slice(0, 3);
                commentsPreview = topComments.map(comment => {
                    const authorChat = this.getChat(comment.authorId);
                    const authorName = authorChat ? (authorChat.nickname || authorChat.name || '匿名') : '匿名';
                    return `${authorName}: ${comment.content}`;
                }).join('；');
            } else {
                commentsPreview = '暂无评论';
            }

            // 构建动态类型描述
            let dynamicTypeText = '文字';
            if (dynamic.image) {
                dynamicTypeText = '图片';
            } else if (dynamic.music) {
                dynamicTypeText = '音乐';
            } else if (dynamic.type === 'mood') {
                dynamicTypeText = '心情';
            } else if (dynamic.type === 'task') {
                dynamicTypeText = '任务';
            }

            // 构建 AI 提示词
            const prompt = `我转发了一条动态给你，内容如下：
发布者：${dynamic.author}
类型：${dynamicTypeText}
内容：${dynamic.content}
点赞数：${dynamic.likes || 0}
评论：${commentsPreview}

请根据你的性格和世界观，对这条动态发表看法（可以是一句话评论、调侃、赞美、无视等），回复要符合你的角色语气。`;

            // 调用 AI 生成回复
            this.callAI(targetChatId, prompt).then(async (aiReply) => {
                if (aiReply) {
                    // 使用 addMessageWithEmotion 处理可能的情绪标签
                    await this.addMessageWithEmotion(targetChatId, aiReply);
                }
            }).catch(error => {
                console.error('[动态转发 AI 回复失败]', error);
            });
        }
    }

    showCommentInput(dynamicId) {
        const inputArea = document.getElementById(`comment-input-${dynamicId}`);
        if (inputArea) {
            // 清除回复上下文
            delete inputArea.dataset.replyTo;
            inputArea.style.display = 'flex';
            const inputField = inputArea.querySelector('.comment-input');
            if (inputField) {
                inputField.placeholder = '发表评论...';
                inputField.focus();
            }
        }
    }

    showCommentMenu(event, dynamicId, commentId) {
        const existingMenu = document.querySelector('.dynamic-popup-menu');
        if (existingMenu) existingMenu.remove();

        const menu = document.createElement('div');
        menu.className = 'dynamic-popup-menu';

        const deleteItem = document.createElement('div');
        deleteItem.className = 'popup-menu-item';
        deleteItem.innerHTML = `
            <span class="popup-menu-icon">🗑️</span>
            <span class="popup-menu-text">删除评论</span>
        `;
        deleteItem.onclick = (e) => {
            e.stopPropagation();
            this.deleteDynamicComment(dynamicId, commentId);
            menu.remove();
        };
        menu.appendChild(deleteItem);

        // 判断是否为真实事件对象
        if (event && event.target && event.target.closest) {
            event.stopPropagation();
            const btn = event.target.closest('.comment-menu-btn');
            if (btn) {
                const rect = btn.getBoundingClientRect();
                menu.style.top = (rect.bottom - 5) + 'px';
                menu.style.right = (window.innerWidth - rect.right) + 'px';
            }
        } else {
            // 非真实事件，显示在屏幕中央
            menu.style.position = 'fixed';
            menu.style.top = '50%';
            menu.style.left = '50%';
            menu.style.transform = 'translate(-50%, -50%)';
        }

        document.body.appendChild(menu);
        const closeHandler = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 10);
    }

    confirmDeleteComment(dynamicId, commentId) {
        const modal = document.getElementById('confirm-modal');
        const title = document.getElementById('confirm-modal-title');
        const message = document.getElementById('confirm-modal-message');
        const confirmBtn = document.getElementById('confirm-confirm-btn');
        const cancelBtn = document.getElementById('confirm-cancel-btn');

        if (!modal) return;

        title.textContent = '删除评论';
        message.textContent = '确定要删除这条评论吗？';
        modal.classList.add('active');

        const onConfirm = () => {
            this.deleteDynamicComment(dynamicId, commentId);
            modal.classList.remove('active');
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
        };

        const onCancel = () => {
            modal.classList.remove('active');
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
        };

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
    }

    deleteDynamicComment(dynamicId, commentId) {
        console.log('deleteDynamicComment 被调用，传入的 commentKey:', commentId);
        const dynamic = this.dynamics.find(d => d.id == dynamicId);
        if (!dynamic || !dynamic.comments) return false;

        const beforeLength = dynamic.comments.length;
        dynamic.comments = dynamic.comments.filter(c => c.id != commentId); // 保留不匹配的评论

        if (dynamic.comments.length < beforeLength) {
            this.saveDynamics();
            this.renderDynamics();
            this.showNotification('评论已删除');
            return true;
        }
        return false;
    }

    addComment(dynamicId) {
        const inputField = document.getElementById(`comment-input-field-${dynamicId}`);
        if (!inputField) return;

        const content = inputField.value.trim();
        if (!content) return;

        const dynamic = this.dynamics.find(d => d.id === dynamicId);
        if (!dynamic) return;

        // 创建评论对象
        const comment = {
            id: 'cmt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            authorId: 'user_mummy',
            authorName: this.mammySettings?.nickname || '我',
            content: content,
            timestamp: Date.now()
        };

        // 添加到评论数组
        if (!dynamic.comments) dynamic.comments = [];
        dynamic.comments.push(comment);

        // 保存并重新渲染
        this.saveDynamics();
        this.renderDynamics();

        // 隐藏输入框
        const inputArea = document.getElementById(`comment-input-${dynamicId}`);
        if (inputArea) {
            inputArea.style.display = 'none';
        }
        inputField.value = '';

        // 触发作者回复
        this.triggerAuthorReplyToMummy(dynamic, comment);
        console.log('触发作者回复妈咪评论', dynamic.author);
    }

    /**
     * 触发作者回复妈咪的评论
     */
    async triggerAuthorReplyToMummy(dynamic, comment) {
        const authorChat = this.chats.find(c => c.id === dynamic.authorId);
        if (!authorChat || authorChat.id === 'user_mummy') return;

        if (Math.random() < 1) {
            const delay = Math.floor(Math.random() * 10000) + 10000;
            setTimeout(async () => {
                // comment 是妈咪的评论
                await this.simulateReplyFromDynamicAuthor(dynamic, authorChat, comment);
                console.log(`触发作者 ${authorChat.name} 回复妈咪的评论`);
            }, delay);
        }
    }

    /**
     * 触发作者回复妈咪的回复
     */
    async triggerReplyToMummy(dynamic, mummyComment, originalComment) {
        // 通过原始评论的作者确定被回复的 AI 角色
        const parentChat = this.chats.find(c => c.id === originalComment.authorId);
        if (!parentChat || parentChat.id === 'user_mummy') return;

        if (Math.random() < 1) {
            const delay = Math.floor(Math.random() * 10000) + 10000;
            setTimeout(async () => {
                // 使用 mummyComment（妈咪的回复）作为目标评论，让 AI 角色去回复
                await this.simulateReplyFromDynamicAuthor(dynamic, parentChat, mummyComment);
                console.log(`触发 ${parentChat.name} 回复妈咪的回复`);
            }, delay);
        }
    }

    /**
     * 模拟用户回复（通用方法）
     */
    async simulateReplyFromUser(dynamicId, userChat, parentComment) {
        const dynamic = this.dynamics.find(d => d.id === dynamicId);
        if (!dynamic) return;

        // 验证日志
        console.log(`[simulateReplyFromUser] 角色: ${userChat.name}, 被回复评论作者: ${parentComment.authorName}, 评论内容: ${parentComment.content}`);

        try {
            // 构建回复提示词
            const replyPrompt = this.buildPromptForOC(userChat, 'reply_comment', {
                commentAuthor: parentComment.authorName,
                commentAuthorId: parentComment.authorId,  // 新增
                commentContent: parentComment.content,
                originalDynamic: dynamic.content,
                isMummy: parentComment.authorId === 'user_mummy'
            });

            // 调用AI生成回复内容
            const replyContent = await this.callAIForDynamic(replyPrompt);

            if (!replyContent) return;

            // 创建回复评论
            const replyComment = {
                id: 'cmt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                authorId: userChat.id,
                authorName: this.getDynamicDisplayName(userChat),
                content: replyContent,
                timestamp: Date.now(),
                replyTo: parentComment.authorName
            };

            dynamic.comments.push(replyComment);
            this.saveDynamics();
            this.renderDynamics();

            console.log(`${userChat.name} 回复了 ${parentComment.authorName} 的评论: ${replyContent}`);

        } catch (error) {
            console.error(`生成回复失败:`, error);
        }
    }

    handleCommentKeyPress(dynamicId, event) {
        if (event.key === 'Enter') {
            const inputArea = document.getElementById(`comment-input-${dynamicId}`);
            if (inputArea && inputArea.dataset.replyTo) {
                const replyToComment = JSON.parse(inputArea.dataset.replyTo);
                this.addReply(dynamicId, replyToComment);
                // 清除回复状态
                delete inputArea.dataset.replyTo;
                inputArea.querySelector('.comment-input').placeholder = '发表评论...';
            } else {
                this.addComment(dynamicId);
            }
        }
    }

    handleSendCommentClick(dynamicId, btnElement) {
        const inputArea = document.getElementById(`comment-input-${dynamicId}`);
        if (!inputArea) return;

        if (inputArea.dataset.replyTo) {
            const replyToComment = JSON.parse(inputArea.dataset.replyTo);
            this.addReply(dynamicId, replyToComment);
            // 清除回复状态
            delete inputArea.dataset.replyTo;
            const inputField = document.getElementById(`comment-input-field-${dynamicId}`);
            if (inputField) inputField.placeholder = '发表评论...';
        } else {
            this.addComment(dynamicId);
        }
    }

    showAllComments(dynamicId) {
        this.showNotification('查看全部评论功能开发中，敬请期待！');
    }

    renderContacts() {
        const contactListEl = document.getElementById('contact-list');
        if (!contactListEl) return;

        // 清空容器
        contactListEl.innerHTML = '';

        // 排序联系人：先按 sortKey 排序，同一 sortKey 按显示名称的拼音顺序排序
        const sortedContacts = [...this.contacts].sort((a, b) => {
            // 获取显示名称：优先使用备注名，其次网名，最后原始名称
            const chatA = this.getChat(a.id);
            const chatB = this.getChat(b.id);
            const nameA = chatA ? (chatA.remarkName || chatA.nickname || chatA.name) : a.name;
            const nameB = chatB ? (chatB.remarkName || chatB.nickname || chatB.name) : b.name;

            // 获取 sortKey：群聊使用 '群聊'，单人聊天使用首字母（非字母使用 '#'）
            const getSortKey = (name) => {
                if (!name) return '#';
                const firstChar = name[0];
                if (/[a-zA-Z]/.test(firstChar)) {
                    return firstChar.toUpperCase();
                }
                return '#';
            };

            const sortKeyA = a.isGroup ? '群聊' : getSortKey(nameA);
            const sortKeyB = b.isGroup ? '群聊' : getSortKey(nameB);

            // 先按 sortKey 排序
            if (sortKeyA < sortKeyB) return -1;
            if (sortKeyA > sortKeyB) return 1;

            // 同一 sortKey 内按显示名称的拼音顺序排序
            return nameA.localeCompare(nameB, 'zh-CN');
        });

        // 按分组整理联系人
        const groups = {};
        sortedContacts.forEach(contact => {
            const groupKey = contact.isGroup ? '群聊' : '单人聊天';
            if (!groups[groupKey]) groups[groupKey] = [];
            groups[groupKey].push(contact);
        });

        // 固定分组顺序：单人聊天在上，群聊在下
        const groupOrder = ['单人聊天', '群聊'];
        groupOrder.forEach(groupName => {
            if (!groups[groupName]) return; // 如果该分组无数据则跳过
            const groupDiv = document.createElement('div');
            groupDiv.className = 'contact-group';

            // 分组头部
            const header = document.createElement('div');
            header.className = 'group-header';
            header.innerHTML = `
                ${groupName}
                ${groupName === '群聊' ? '<button class="create-group-btn" onclick="chatManager.showCreateGroupModal()">➕</button>' : ''}
                ${groupName === '单人聊天' ? '<button class="create-group-btn" onclick="chatManager.showCreateCharacterModal()">➕</button>' : ''}
            `;
            groupDiv.appendChild(header);

            // 联系人列表容器
            const contentsDiv = document.createElement('div');
            contentsDiv.className = 'group-contents';

            groups[groupName].forEach(contact => {
                const item = this.createSwipeableContactItem(contact);
                contentsDiv.appendChild(item);
            });

            groupDiv.appendChild(contentsDiv);
            contactListEl.appendChild(groupDiv);
        });
    }

    createSwipeableContactItem(contact) {
        const chat = this.getChat(contact.id);
        const displayName = chat ? (chat.remarkName || chat.nickname || chat.name) : contact.name;
        const avatar = contact.avatar || '👤';

        // 创建容器
        const item = document.createElement('div');
        item.className = 'contact-item swipeable';
        item.dataset.id = contact.id;

        // 头像
        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'contact-avatar';
        if (avatar && typeof avatar === 'string' && avatar.startsWith('http')) {
            avatarDiv.innerHTML = `<img src="${avatar}" style="width: 100%; height: 100%; object-fit: cover;">`;
        } else {
            avatarDiv.innerHTML = `<span>${avatar}</span>`;
        }

        // 信息区域
        const infoDiv = document.createElement('div');
        infoDiv.className = 'contact-info';
        infoDiv.innerHTML = `<div class="contact-name">${displayName}</div>`;

        item.appendChild(avatarDiv);
        item.appendChild(infoDiv);

        // 滑动删除按钮
        const deleteBtn = document.createElement('div');
        deleteBtn.className = 'contact-delete-btn';
        deleteBtn.innerHTML = '<span>删除</span>';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            this.deleteContact(contact.id);
        };
        item.appendChild(deleteBtn);

        // 点击打开聊天
        item.addEventListener('click', (e) => {
            if (!item.classList.contains('swiped')) {
                this.openChat(contact.id);
            }
        });

        // 绑定滑动事件
        this.bindSwipeEvents(item);

        return item;
    }

    bindSwipeEvents(item) {
        let startX = 0;
        let currentX = 0;
        let isSwiping = false;
        const threshold = 60; // 滑动阈值

        const handleTouchStart = (e) => {
            startX = e.touches[0].clientX;
            isSwiping = true;
            item.classList.remove('swiped');
        };

        const handleTouchMove = (e) => {
            if (!isSwiping) return;
            currentX = e.touches[0].clientX;
            const diff = startX - currentX;
            if (diff > 10) {
                e.preventDefault();
                item.style.transform = `translateX(-${Math.min(diff, 80)}px)`;
            }
        };

        const handleTouchEnd = () => {
            if (!isSwiping) return;
            const diff = startX - currentX;
            if (diff > threshold) {
                item.classList.add('swiped');
                item.style.transform = 'translateX(-80px)';
            } else {
                item.style.transform = 'translateX(0)';
            }
            isSwiping = false;
        };

        // 鼠标事件模拟（用于开发调试）
        let mouseDown = false;
        item.addEventListener('mousedown', (e) => {
            startX = e.clientX;
            mouseDown = true;
            item.classList.remove('swiped');
        });
        item.addEventListener('mousemove', (e) => {
            if (!mouseDown) return;
            currentX = e.clientX;
            const diff = startX - currentX;
            if (diff > 10) {
                e.preventDefault();
                item.style.transform = `translateX(-${Math.min(diff, 80)}px)`;
            }
        });
        item.addEventListener('mouseup', () => {
            if (!mouseDown) return;
            const diff = startX - currentX;
            if (diff > threshold) {
                item.classList.add('swiped');
                item.style.transform = 'translateX(-80px)';
            } else {
                item.style.transform = 'translateX(0)';
            }
            mouseDown = false;
        });
        item.addEventListener('mouseleave', () => {
            if (mouseDown) {
                item.style.transform = 'translateX(0)';
                mouseDown = false;
            }
        });

        item.addEventListener('touchstart', handleTouchStart);
        item.addEventListener('touchmove', handleTouchMove);
        item.addEventListener('touchend', handleTouchEnd);
    }

    deleteContact(contactId) {
        const chat = this.getChat(contactId);
        const name = chat ? (chat.remarkName || chat.nickname || chat.name) : '该联系人';

        const modal = document.getElementById('confirm-modal');
        const title = document.getElementById('confirm-modal-title');
        const message = document.getElementById('confirm-modal-message');
        const confirmBtn = document.getElementById('confirm-confirm-btn');
        const cancelBtn = document.getElementById('confirm-cancel-btn');

        if (!modal || !title || !message) return;

        title.textContent = '删除联系人';
        message.textContent = `确定要删除"${name}"吗？此操作不可恢复。`;
        modal.classList.add('active');

        const onConfirm = () => {
            // 执行删除
            this.chats = this.chats.filter(c => c.id !== contactId);

            if (this.currentChat && this.currentChat.id === contactId) {
                this.closeChat();
            }

            this.syncContactsFromChats();
            this.saveChats();
            this.renderContacts();
            this.renderChatList();
            this.showNotification(`已删除"${name}"`);

            modal.classList.remove('active');
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
        };

        const onCancel = () => {
            modal.classList.remove('active');
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
        };

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
    }

    showCreateGroupModal(callback = null) {
        const modal = document.getElementById('create-group-modal');
        if (!modal) return;

        // 加载可选的成员列表（排除群聊和妈咪）
        const memberSelection = document.getElementById('member-selection');
        if (memberSelection) {
            // 从contacts获取所有非群聊、非妈咪的角色（现有OC）
            let members = this.contacts.filter(c => !c.isGroup && c.id !== 'mammy');
            // 新建群聊时，只排除当前正在编辑的群聊的成员（如果有）
            if (this.currentChat && this.currentChat.isGroup) {
                const currentMembers = new Set(this.currentChat.members || []);
                members = members.filter(m => !currentMembers.has(m.id));
            }
            // 若是新建群聊（无 currentChat 或 currentChat 不是群聊），则不做排除

            // 从worldBooks获取所有NPC
            const npcMembers = [];
            (this.worldBooks || []).forEach(world => {
                if (world.npcs && world.npcs.length > 0) {
                    world.npcs.forEach(npc => {
                        // 确保NPC ID唯一
                        const npcId = `npc_${world.id}_${npc.id}`;
                        // 直接添加NPC，不再检查是否在群聊中
                        npcMembers.push({
                            id: npcId,
                            name: npc.name,
                            avatar: npc.avatar || '👤',
                            type: 'npc',
                            worldId: world.id,
                            npcId: npc.id
                        });
                    });
                }
            });

            // 合并OC和NPC成员
            const allMembers = [...members, ...npcMembers];

            memberSelection.innerHTML = allMembers.map(member => {
                // 处理头像显示
                let avatarContent;
                if (member.avatar && (member.avatar.startsWith('http://') || member.avatar.startsWith('https://'))) {
                    avatarContent = `<img src="${member.avatar}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span class="emoji-fallback" style="display: none;">👤</span>`;
                } else {
                    avatarContent = `<span>${member.avatar || '👤'}</span>`;
                }

                return `
                    <div class="member-item" data-id="${member.id}">
                        <input type="checkbox" id="member-${member.id}">
                        <label for="member-${member.id}">
                            <div class="member-avatar">${avatarContent}</div>
                            <span>${member.name}</span>
                        </label>
                    </div>
                `;
            }).join('');
        }

        modal.classList.add('active');
    }

    closeCreateGroupModal() {
        const modal = document.getElementById('create-group-modal');
        if (modal) modal.classList.remove('active');
    }

    createGroup() {
        const groupName = document.getElementById('group-name-input')?.value;
        const memberItems = document.querySelectorAll('#member-selection .member-item');
        const selectedMembers = [];

        memberItems.forEach(item => {
            const checkbox = item.querySelector('input[type="checkbox"]');
            if (checkbox && checkbox.checked) {
                selectedMembers.push(item.dataset.id);
            }
        });

        if (!groupName || groupName.trim() === '') {
            this.showNotification('请输入群聊名称');
            return;
        }

        if (selectedMembers.length < 2) {
            this.showNotification('请至少选择2个成员');
            return;
        }

        // 创建新的群聊
        const groupId = 'group_' + Date.now();
        const groupContact = {
            id: groupId,
            name: groupName,
            avatar: '👥',
            isGroup: true,
            members: selectedMembers,
            isOnline: true
        };

        const groupChat = {
            id: groupId,
            name: groupName,
            avatar: '👥',
            isGroup: true,
            members: selectedMembers,
            messages: [{
                sender: 'system',
                content: '群聊已创建',
                timestamp: new Date().toISOString(),
                isSystem: true
            }],
            lastMessage: '群聊已创建',
            lastTime: this.getRelativeTime(new Date()),
            lastTimestamp: new Date().toISOString(),
            unreadCount: 0
        };

        // 检查群聊人数是否足够（创建时立即检查）
        const totalMembers = (groupChat.members?.length || 0) + 1;
        if (totalMembers <= 2) {
            // 人数不足，延迟一小段时间再解散，以便用户看到创建成功的提示
            setTimeout(() => {
                this.disbandGroup(groupId);
            }, 500);
            return; // 不添加到 chats 和 contacts 中
        }

        // 添加到数据
        this.contacts.push(groupContact);
        this.chats.push(groupChat);

        // 保存并刷新
        this.saveChats();
        this.renderContacts();
        this.renderChatList();

        // 🔧 新增：切换到消息页面并滚动到顶部
        this.switchPage('message');
        const chatListEl = document.getElementById('chat-list');
        if (chatListEl) chatListEl.scrollTop = 0;

        // 关闭弹窗
        this.closeCreateGroupModal();

        // 设置最后创建的群聊ID，用于转发
        this.lastCreatedGroupId = groupId;

        // 执行回调
        if (typeof callback === 'function') {
            callback();
        }

        // 清空表单
        document.getElementById('group-name-input').value = '';
        memberItems.forEach(item => {
            const checkbox = item.querySelector('input[type="checkbox"]');
            if (checkbox) checkbox.checked = false;
        });

        // 触发群事件讨论：群聊创建成功
        this.triggerGroupEventDiscussion(groupId, '群聊已创建，大家打个招呼吧');
    }

    selectAllMembers() {
        const checkboxes = document.querySelectorAll('#member-selection input[type="checkbox"]');
        checkboxes.forEach(checkbox => checkbox.checked = true);
    }

    deselectAllMembers() {
        const checkboxes = document.querySelectorAll('#member-selection input[type="checkbox"]');
        checkboxes.forEach(checkbox => checkbox.checked = false);
    }

    showPartnerSelector() {
    const modal = document.getElementById('partner-selector-modal');
    if (!modal) return;

    // 加载可选的角色列表（排除群聊、妈咪和当前聊天角色）
    const container = document.getElementById('partner-selection-list');
    if (container) {
        let partners = this.contacts.filter(c => !c.isGroup && c.id !== 'mammy' && c.id !== this.currentChat?.id);

        // 排除已经是配对角色的（避免重复添加）
        const existingPartnerIds = this.currentChat?.partnerIds || [];
        partners = partners.filter(p => !existingPartnerIds.includes(p.id));

        if (partners.length === 0) {
            container.innerHTML = '<p style="padding: 12px; text-align: center; color: var(--text-secondary);">暂无可添加的角色</p>';
        } else {
            container.innerHTML = partners.map(partner => {
                const chat = this.getChat(partner.id);
                const displayName = chat ? (chat.name || chat.remarkName || chat.nickname) : partner.name;
                const avatar = partner.avatar || '👤';
                let avatarContent;
                if (avatar && typeof avatar === 'string' && (avatar.startsWith('http://') || avatar.startsWith('https://'))) {
                    avatarContent = `<img src="${avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
                } else {
                    avatarContent = `<span>${avatar}</span>`;
                }

                return `
                    <div class="member-item" data-id="${partner.id}">
                        <input type="checkbox" id="partner-${partner.id}" value="${partner.id}">
                        <label for="partner-${partner.id}" style="display: flex; align-items: center; gap: 10px; width: 100%; cursor: pointer;">
                            <div class="member-avatar" style="width: 40px; height: 40px; border-radius: 50%; background: var(--nav-active-bg); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                ${avatarContent}
                            </div>
                            <span style="font-size: 14px; color: var(--text-primary);">${displayName}</span>
                        </label>
                    </div>
                `;
            }).join('');
        }
    }

    modal.classList.add('active');
}

    closePartnerSelector() {
        const modal = document.getElementById('partner-selector-modal');
        if (modal) modal.classList.remove('active');
    }

    /**
     * 打开群聊设置页面
     */
    openGroupSettings(chatId) {
        const chat = this.getChat(chatId);
        if (!chat || !chat.isGroup) {
            console.error('无法打开群聊设置：不是群聊');
            return;
        }

        this.currentChat = chat;
        const panel = document.getElementById('group-settings-panel');
        if (!panel) return;

        // 填充群聊设置数据
        document.getElementById('group-settings-name-input').value = chat.name || '';
        document.getElementById('group-settings-avatar-input').value = chat.avatar || '';
        document.getElementById('group-settings-chatbg-input').value = chat.chatBg || '';
        document.getElementById('group-settings-nickname-input').value = chat.groupNickname || '';
        document.getElementById('group-notice-input').value = chat.groupNotice || '';
        document.getElementById('group-pat-style-input').value = chat.groupPatStyle || '拍了拍群';
        // 自动发言设置
        document.getElementById('group-auto-chat-switch').checked = chat.autoChatEnabled || false;
        document.getElementById('group-auto-chat-interval').value = chat.autoChatIntervalValue || 30;
        document.getElementById('group-auto-chat-unit').value = chat.autoChatIntervalUnit || 'minute';
        // 回复快慢系数
        document.getElementById('group-reply-speed').value = chat.replySpeedFactor || 1.0;
        document.getElementById('group-speed-value').textContent = chat.replySpeedFactor || 1.0;
        // 对话链最大深度
        const maxDepthSlider = document.getElementById('group-max-depth');
        const maxDepthValue = document.getElementById('group-max-depth-value');
        if (maxDepthSlider && maxDepthValue) {
            const currentDepth = chat.maxConversationDepth || 4;
            maxDepthSlider.value = currentDepth;
            maxDepthValue.textContent = currentDepth;
            // 绑定实时更新数字的事件
            maxDepthSlider.oninput = (e) => {
                maxDepthValue.textContent = e.target.value;
            };
        }
        // 更新预览区显示
        this.updateGroupAvatarPreview(chat.avatar || '👥');

        // 渲染成员列表
        this.renderGroupMemberList();

        // 渲染禁言管理列表
        this.renderGroupMuteList();

        // 渲染管理员列表
        this.renderGroupAdminList();

        // 渲染 NPC 选择器
        this.renderNPCSelector();

        // 绑定按钮事件
        const closeBtn = document.getElementById('close-group-settings');
        if (closeBtn) {
            closeBtn.onclick = () => this.closeGroupSettings();
        }

        const saveBtn = document.getElementById('save-group-settings');
        if (saveBtn) {
            saveBtn.onclick = () => this.saveGroupSettings();
        }

        // 绑定滑块数值显示更新
        const speedSlider = document.getElementById('group-reply-speed');
        const speedValue = document.getElementById('group-speed-value');
        if (speedSlider && speedValue) {
            speedSlider.oninput = (e) => {
                speedValue.textContent = e.target.value;
            };
        }

        // 绑定删除群聊按钮事件
        const deleteBtn = document.getElementById('delete-group-btn');
        if (deleteBtn) {
            deleteBtn.onclick = () => this.deleteCurrentGroup();
        }

        // 清理已过期的禁言记录
        this.cleanExpiredMutes(chat);

        panel.classList.add('active');

        // 头像输入框实时预览
        const avatarInput = document.getElementById('group-settings-avatar-input');
        if (avatarInput) {
            avatarInput.oninput = (e) => this.updateGroupAvatarPreview(e.target.value);
        }
    }

    /**
     * 更新群公告栏
     */
    updateGroupNoticeBar(chat) {
        const noticeBar = document.getElementById('group-notice-bar');
        const noticeText = document.getElementById('group-notice-text');
        const toggleBtn = document.getElementById('toggle-notice-btn');
        if (!noticeBar || !noticeText) return;
        if (chat.groupNotice && chat.groupNotice.trim() !== '') {
            noticeText.textContent = chat.groupNotice;
            noticeBar.style.display = 'flex';
            noticeBar.classList.remove('collapsed');
            if (toggleBtn) toggleBtn.textContent = '▲';
        } else {
            noticeBar.style.display = 'none';
        }
    }

    /**
     * 关闭群聊设置页面
     */
    closeGroupSettings() {
        const panel = document.getElementById('group-settings-panel');
        if (panel) panel.classList.remove('active');
    }

    /**
     * 渲染群成员列表
     */
    renderGroupMemberList() {
        if (!this.currentChat || !this.currentChat.isGroup) return;

        const memberGridEl = document.getElementById('group-member-grid');
        if (!memberGridEl) return;

        const members = this.currentChat.members || [];
        if (members.length === 0) {
            memberGridEl.innerHTML = '<p style="padding: 12px; text-align: center; color: var(--text-secondary);">暂无成员</p>';
            return;
        }

        memberGridEl.innerHTML = members.map(memberId => {
            const memberInfo = this.getMemberDisplayInfo(memberId);
            if (!memberInfo) return '';

            // 获取显示名称，优先使用群内昵称
            const groupNickname = this.currentChat.groupNicknames && this.currentChat.groupNicknames[memberId];
            const displayName = groupNickname || memberInfo.name || '未知成员';
            const avatar = memberInfo.avatar;
            let avatarContent;

            if (avatar && typeof avatar === 'string' && (avatar.startsWith('http://') || avatar.startsWith('https://'))) {
                avatarContent = `<img src="${avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span class="emoji-fallback" style="display: none;">👤</span>`;
            } else {
                avatarContent = `<span style="font-size: 24px;">${avatar}</span>`;
            }

            return `
                <div class="member-item" data-id="${memberId}" style="display: flex; flex-direction: column; align-items: center; padding: 8px; position: relative;">
                    <div class="member-avatar" style="width: 50px; height: 50px; border-radius: 50%; background: var(--nav-active-bg); display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-bottom: 4px;">
                        ${avatarContent}
                    </div>
                    <span style="font-size: 12px; color: var(--text-primary); text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">${displayName}</span>
                    <button class="delete-btn" onclick="chatManager.removeMemberFromGroup('${memberId}')" style="position: absolute; top: 4px; right: 4px; padding: 2px 6px; font-size: 10px; background: #e53e3e; color: white; border: none; border-radius: 10px; cursor: pointer; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;">✕</button>
                </div>
            `;
        }).join('');
    }

    /**
     * 更新群聊头像预览
     */
    updateGroupAvatarPreview(avatarValue) {
        const previewEl = document.getElementById('group-avatar-preview-content');
        if (!previewEl) return;
        if (avatarValue && (avatarValue.startsWith('http://') || avatarValue.startsWith('https://'))) {
            previewEl.innerHTML = `<img src="${avatarValue}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
        } else {
            previewEl.textContent = avatarValue || '👥';
        }
    }

    /**
     * 保存群聊设置
     */
    saveGroupSettings() {
        if (!this.currentChat || !this.currentChat.isGroup) {
            this.showNotification('无法保存：未选择群聊');
            return;
        }

        // 获取表单值
        const groupName = document.getElementById('group-settings-name-input').value;
        const groupAvatar = document.getElementById('group-settings-avatar-input').value;
        const groupChatBg = document.getElementById('group-settings-chatbg-input').value;
        const groupNickname = document.getElementById('group-settings-nickname-input').value;
        const groupNotice = document.getElementById('group-notice-input').value;
        const groupPatStyle = document.getElementById('group-pat-style-input').value;

        this.currentChat.autoChatEnabled = document.getElementById('group-auto-chat-switch').checked;
        this.currentChat.autoChatIntervalValue = parseInt(document.getElementById('group-auto-chat-interval').value);
        this.currentChat.autoChatIntervalUnit = document.getElementById('group-auto-chat-unit').value;
        this.currentChat.replySpeedFactor = parseFloat(document.getElementById('group-reply-speed').value);
        this.currentChat.maxConversationDepth = parseInt(document.getElementById('group-max-depth').value) || 4;

        if (!groupName || groupName.trim() === '') {
            this.showNotification('群名称不能为空');
            return;
        }

        const mammyNick = this.mammySettings.nickname || '妈咪';
        const oldName = this.currentChat.name;
        const newName = groupName.trim();

        // 处理群名称修改
        if (newName && oldName !== newName) {
            this.currentChat.name = newName;
            delete this.currentChat.nickname;

            const chatIndex = this.chats.findIndex(c => c.id === this.currentChat.id);
            if (chatIndex !== -1) {
                this.chats[chatIndex].name = newName;
                delete this.chats[chatIndex].nickname;
            }

            const groupContact = this.contacts.find(c => c.id === this.currentChat.id);
            if (groupContact) {
                groupContact.name = newName;
            }

            const chatTitle = document.getElementById('chat-title');
            if (chatTitle) {
                chatTitle.textContent = newName;
            }

            const sysMsg = {
                text: `${mammyNick} 修改群名称为 "${newName}"`,
                content: `${mammyNick} 修改群名称为 "${newName}"`,
                timestamp: new Date().toISOString(),
                isSystem: true
            };
            this.currentChat.messages.push(sysMsg);
            this.currentChat.lastMessage = sysMsg.text;
            this.currentChat.lastTimestamp = sysMsg.timestamp;
            this.currentChat.lastTime = this.getRelativeTime(new Date());

            if (this.currentChat) {
                this.renderMessages(this.currentChat);
                this.scrollToBottom();
            }

            // 触发群成员讨论群名变更
            this.triggerGroupEventDiscussion(this.currentChat.id, `妈咪将群名改成了"${newName}"`);
        }

        // 处理群公告修改
        const oldNotice = this.currentChat.groupNotice || '';
        const newNotice = groupNotice.trim();
        if (oldNotice !== newNotice) {
            this.currentChat.groupNotice = newNotice;

            const sysMsg = {
                text: `${mammyNick} 更新了群公告`,
                content: `${mammyNick} 更新了群公告`,
                timestamp: new Date().toISOString(),
                isSystem: true
            };
            this.currentChat.messages.push(sysMsg);
            this.currentChat.lastMessage = sysMsg.text;
            this.currentChat.lastTimestamp = sysMsg.timestamp;
            this.currentChat.lastTime = this.getRelativeTime(new Date());

            if (this.currentChat) {
                this.renderMessages(this.currentChat);
                this.scrollToBottom();
            }

            // 触发群成员讨论公告内容
            if (newNotice !== '') {
                this.triggerGroupEventDiscussion(this.currentChat.id, `妈咪修改了群公告，新公告内容是："${newNotice}"`);
            }
        }

        // 更新群聊数据
        this.currentChat.avatar = groupAvatar || '👥';
        this.currentChat.chatBg = groupChatBg;
        this.currentChat.groupNickname = groupNickname;
        this.currentChat.groupPatStyle = groupPatStyle;

        const groupContactForAvatar = this.contacts.find(c => c.id === this.currentChat.id);
        if (groupContactForAvatar) {
            groupContactForAvatar.avatar = groupAvatar || '👥';
        }

        this.saveChats();
        this.renderChatList();
        this.renderContacts();

        const chatTitleEl = document.getElementById('chat-title');
        const chatAvatarEmojiEl = document.getElementById('chat-avatar-emoji');
        if (chatTitleEl) chatTitleEl.textContent = groupName;
        if (chatAvatarEmojiEl && groupAvatar) {
            if (groupAvatar.startsWith('http://') || groupAvatar.startsWith('https://')) {
                chatAvatarEmojiEl.innerHTML = `<img src="${groupAvatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span class="emoji-fallback" style="display: none;">👥</span>`;
            } else {
                chatAvatarEmojiEl.textContent = groupAvatar;
            }
        }

        this.updateChatBackground(this.currentChat);

        if (groupNickname) {
            this.currentChat.messages.forEach(msg => {
                if (msg.isMe) msg.senderGroupNickname = groupNickname;
            });
        }

        if (this.currentChat && this.currentChat.id === this.currentChat.id) {
            this.updateGroupNoticeBar(this.currentChat);
        }

        const npcSelect = document.getElementById('npc-selector');
        if (npcSelect && npcSelect.value) {
            this.saveNPCSettings(npcSelect.value);
        }

        this.showNotification('群聊设置已保存');
        this.closeGroupSettings();

        if (oldNotice !== newNotice && newNotice !== '') {
            this.triggerGroupEventDiscussion(this.currentChat.id, '妈咪修改了群公告');
        }
    }

    /**
     * 渲染 NPC 选择器
     */
    renderNPCSelector() {
        const npcSettingsGroup = document.getElementById('npc-settings-group');
        const npcSelect = document.getElementById('npc-selector');
        if (!npcSettingsGroup || !npcSelect) return;

        const members = this.currentChat.members || [];
        const npcMembers = members.filter(id => id.startsWith('npc_'));

        if (npcMembers.length === 0) {
            npcSettingsGroup.style.display = 'none';
            return;
        }

        npcSettingsGroup.style.display = 'block';
        npcSelect.innerHTML = '<option value="">-- 请选择 NPC --</option>';
        npcMembers.forEach(id => {
            const info = this.getMemberDisplayInfo(id);
            const option = document.createElement('option');
            option.value = id;
            option.textContent = info.name;
            npcSelect.appendChild(option);
        });

        npcSelect.onchange = () => {
            const selectedId = npcSelect.value;
            const panel = document.getElementById('npc-params-panel');
            if (!panel) return;
            if (selectedId) {
                this.loadNPCSettings(selectedId);
                panel.style.display = 'block';
            } else {
                panel.style.display = 'none';
            }
        };

        // 绑定保存按钮事件（使用事件委托避免重复绑定）
        const saveBtn = document.getElementById('save-npc-settings-btn');
        if (saveBtn) {
            saveBtn.onclick = () => {
                const selectedId = npcSelect.value;
                if (selectedId) {
                    this.saveNPCSettings(selectedId);
                    this.showNotification('NPC 设置已保存');
                }
            };
        }
    }

    /**
     * 加载指定 NPC 的设置到表单
     */
    loadNPCSettings(npcId) {
        const panel = document.getElementById('npc-params-panel');
        if (!panel) return;

        if (!this.currentChat.npcSettings) {
            this.currentChat.npcSettings = {};
        }

        const settings = this.currentChat.npcSettings[npcId] || {};

        const replyTemp = document.getElementById('npc-reply-temp');
        const emojiFreq = document.getElementById('npc-emoji-freq');
        const imageFreq = document.getElementById('npc-image-freq');
        const videoFreq = document.getElementById('npc-video-freq');

        if (replyTemp) replyTemp.value = settings.replyTemp || 0.5;
        if (emojiFreq) emojiFreq.value = settings.emojiFreq || 0.5;
        if (imageFreq) imageFreq.value = settings.imageFrequency || 0;
        if (videoFreq) videoFreq.value = settings.videoFrequency || 0;

        // 更新显示数值
        const tempSpan = document.getElementById('npc-temp-value');
        const emojiSpan = document.getElementById('npc-emoji-freq-value');
        const imageSpan = document.getElementById('npc-image-freq-value');
        const videoSpan = document.getElementById('npc-video-freq-value');
        if (tempSpan) tempSpan.textContent = replyTemp.value;
        if (emojiSpan) emojiSpan.textContent = emojiFreq.value;
        if (imageSpan) imageSpan.textContent = imageFreq.value;
        if (videoSpan) videoSpan.textContent = videoFreq.value;

        // 绑定滑块事件
        if (replyTemp) replyTemp.oninput = () => { tempSpan.textContent = replyTemp.value; };
        if (emojiFreq) emojiFreq.oninput = () => { emojiSpan.textContent = emojiFreq.value; };
        if (imageFreq) imageFreq.oninput = () => { imageSpan.textContent = imageFreq.value; };
        if (videoFreq) videoFreq.oninput = () => { videoSpan.textContent = videoFreq.value; };
    }

    /**
     * 保存当前选中的 NPC 设置
     */
    saveNPCSettings(npcId) {
        if (!this.currentChat.npcSettings) {
            this.currentChat.npcSettings = {};
        }

        const replyTemp = document.getElementById('npc-reply-temp');
        const emojiFreq = document.getElementById('npc-emoji-freq');
        const imageFreq = document.getElementById('npc-image-freq');
        const videoFreq = document.getElementById('npc-video-freq');

        this.currentChat.npcSettings[npcId] = {
            replyTemp: replyTemp ? parseFloat(replyTemp.value) : 0.5,
            emojiFreq: emojiFreq ? parseFloat(emojiFreq.value) : 0.5,
            imageFrequency: imageFreq ? parseFloat(imageFreq.value) : 0,
            videoFrequency: videoFreq ? parseFloat(videoFreq.value) : 0
        };

        // 🔧 新增：立即保存到 localStorage，确保不丢失
        this.saveChats();
    }

    /**
     * 更新聊天背景
     */
    updateChatBackground(chat) {
        const chatMessagesEl = document.getElementById('chat-messages');
        if (!chatMessagesEl) return;

        if (chat && chat.chatBg) {
            chatMessagesEl.style.backgroundImage = `url('${chat.chatBg}')`;
            chatMessagesEl.style.backgroundSize = 'cover';
            chatMessagesEl.style.backgroundPosition = 'center';
            chatMessagesEl.style.backgroundRepeat = 'no-repeat';
        } else {
            chatMessagesEl.style.backgroundImage = 'none';
        }
    }

    /**
     * 显示添加成员弹窗
     */
    showAddMemberModal() {
        if (!this.currentChat || !this.currentChat.isGroup) {
            this.showNotification('请先选择群聊');
            return;
        }

        const modal = document.getElementById('add-member-modal');
        if (!modal) return;

        // 加载可选的成员列表（排除已在群聊中的成员）
        const availableListEl = document.getElementById('available-member-list');
        if (availableListEl) {
            // 获取所有非群聊、非妈咪的联系人
            let availableMembers = this.contacts.filter(c => !c.isGroup && c.id !== 'user_mummy' && c.id !== 'mammy');

            // 排除已在群聊中的成员
            const existingMembers = new Set(this.currentChat.members || []);
            availableMembers = availableMembers.filter(m => !existingMembers.has(m.id));

            // 从世界书中获取NPC
            const npcMembers = [];
            (this.worldBooks || []).forEach(world => {
                if (world.npcs && world.npcs.length > 0) {
                    world.npcs.forEach(npc => {
                        const npcId = `npc_${world.id}_${npc.id}`;
                        if (!existingMembers.has(npcId)) {
                            npcMembers.push({
                                id: npcId,
                                name: npc.name,
                                avatar: npc.avatar || '👤',
                                type: 'npc'
                            });
                        }
                    });
                }
            });

            // 合并所有可选成员
            const allAvailableMembers = [...availableMembers, ...npcMembers];

            if (allAvailableMembers.length === 0) {
                availableListEl.innerHTML = '<p style="padding: 12px; text-align: center; color: var(--text-secondary);">暂无可添加的成员</p>';
            } else {
                availableListEl.innerHTML = allAvailableMembers.map(member => {
                    let avatarContent;
                    const avatar = member.avatar || '👤';
                    if (avatar && typeof avatar === 'string' && (avatar.startsWith('http://') || avatar.startsWith('https://'))) {
                        avatarContent = `<img src="${avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span class="emoji-fallback" style="display: none;">👤</span>`;
                    } else {
                        avatarContent = `<span>${avatar}</span>`;
                    }

                    return `
                        <div class="member-item" data-id="${member.id}">
                            <input type="checkbox" id="available-member-${member.id}" value="${member.id}">
                            <label for="available-member-${member.id}" style="display: flex; align-items: center; gap: 10px; width: 100%; cursor: pointer;">
                                <div class="member-avatar" style="width: 40px; height: 40px; border-radius: 50%; background: var(--nav-active-bg); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                    ${avatarContent}
                                </div>
                                <span style="font-size: 14px; color: var(--text-primary);">${member.name}</span>
                            </label>
                        </div>
                    `;
                }).join('');
            }
        }

        modal.classList.add('active');
    }

    /**
     * 关闭添加成员弹窗
     */
    closeAddMemberModal() {
        const modal = document.getElementById('add-member-modal');
        if (modal) modal.classList.remove('active');
    }

    /**
     * 添加成员到群聊
     */
    addMembersToGroup() {
        if (!this.currentChat || !this.currentChat.isGroup) return;

        const checkboxes = document.querySelectorAll('#available-member-list input[type="checkbox"]');
        const selectedIds = Array.from(checkboxes)
            .filter(cb => cb.checked)
            .map(cb => cb.value)
            .filter(id => id && id !== 'on'); // 过滤掉无效值

        if (selectedIds.length === 0) {
            this.showNotification('请选择要添加的成员');
            return;
        }

        // 添加到群聊成员列表
        if (!this.currentChat.members) this.currentChat.members = [];
        this.currentChat.members.push(...selectedIds);

        // 发送系统消息
        const addedNames = [];
        selectedIds.forEach(memberId => {
            const memberInfo = this.getMemberDisplayInfo(memberId);
            const name = memberInfo.name;
            addedNames.push(name);
        });

        addedNames.forEach(name => {
            const sysMsg = {
                text: `${name} 加入了群聊`,
                content: `${name} 加入了群聊`,
                timestamp: new Date().toISOString(),
                isSystem: true
            };
            this.currentChat.messages.push(sysMsg);
        });
        this.currentChat.lastMessage = addedNames.map(n => `${n} 加入了群聊`).join('；');
        this.currentChat.lastTimestamp = new Date().toISOString();
        this.currentChat.lastTime = this.getRelativeTime(new Date());

        this.saveChats();

        // 🔧 新增：如果当前聊天窗口正是该群聊，立即刷新消息区
        if (this.currentChat && this.currentChat.id === this.currentChat.id) {
            this.renderMessages(this.currentChat);
            this.scrollToBottom();
        }

        this.renderGroupMemberList();
        this.renderChatList();
        this.renderContacts();

        // 刷新禁言管理列表（如果群设置页正打开）
        if (document.getElementById('group-settings-panel').classList.contains('active')) {
            this.renderGroupMuteList();
            this.renderNPCSelector();
        }

        this.showNotification(`已添加 ${selectedIds.length} 个成员`);
        this.closeAddMemberModal();

        // 触发群事件讨论：新成员加入
        const memberNames = addedNames.join('、');
        this.triggerGroupEventDiscussion(this.currentChat.id, `${memberNames} 加入了群聊`);
    }

    /**
     * 从群聊中移除成员
     */
    removeMemberFromGroup(memberId, operatorId = null) {
        if (!this.currentChat || !this.currentChat.isGroup) return;

        // 不能移除自己
        if (memberId === 'user_mummy') {
            this.showNotification('不能移除自己');
            return;
        }

        // 获取成员名称（用于系统消息）
        const memberInfo = this.getMemberDisplayInfo(memberId);
        const memberName = memberInfo.name;
        // 获取操作者的昵称，如果未传入则默认为妈咪
        let operatorName = this.mammySettings.nickname || '妈咪';
        if (operatorId) {
            const operatorInfo = this.getMemberDisplayInfo(operatorId);
            operatorName = operatorInfo.name;
        }

        // 从成员列表中移除
        if (this.currentChat.members) {
            this.currentChat.members = this.currentChat.members.filter(id => id !== memberId);
        }

        // 发送系统消息
        const sysMsg = {
            text: `${memberName} 被 ${operatorName} 移出群聊`,
            content: `${memberName} 被 ${operatorName} 移出群聊`,
            timestamp: new Date().toISOString(),
            isSystem: true
        };
        this.currentChat.messages.push(sysMsg);
        this.currentChat.lastMessage = sysMsg.text;
        this.currentChat.lastTimestamp = sysMsg.timestamp;
        this.currentChat.lastTime = this.getRelativeTime(new Date());

        // 保存并刷新
        this.saveChats();

        // 如果群设置面板正打开，刷新禁言管理列表
        if (document.getElementById('group-settings-panel').classList.contains('active')) {
            this.renderGroupMuteList();
            this.renderNPCSelector();
        }

        // 刷新成员网格
        this.renderGroupMemberList();
        this.renderChatList();

        // 检查群聊人数是否足够
        this.checkAndDisbandGroupIfNeeded(this.currentChat.id);

        // 🔧 如果当前聊天窗口正是该群聊，立即刷新消息区
        if (this.currentChat && this.currentChat.id === this.currentChat.id) {
            this.renderMessages(this.currentChat);
            this.scrollToBottom();
        }

        this.showNotification('成员已移除');
    }

    /**
     * 全选可用成员
     */
    selectAllAvailableMembers() {
        const checkboxes = document.querySelectorAll('#available-member-list input[type="checkbox"]');
        checkboxes.forEach(checkbox => checkbox.checked = true);
    }

    /**
     * 取消全选可用成员
     */
    deselectAllAvailableMembers() {
        const checkboxes = document.querySelectorAll('#available-member-list input[type="checkbox"]');
        checkboxes.forEach(checkbox => checkbox.checked = false);
    }

    addPartners() {
    const container = document.getElementById('partner-selection-list');
    if (!container) return;

    const checkboxes = container.querySelectorAll('input[type="checkbox"]:checked');
    const selectedIds = Array.from(checkboxes).map(cb => cb.value);

    if (selectedIds.length === 0) {
        this.showNotification('请选择至少一个配对角色');
        return;
    }

    // 添加到当前聊天的 partnerIds
    if (!this.currentChat.partnerIds) this.currentChat.partnerIds = [];
    this.currentChat.partnerIds.push(...selectedIds);

    // 保存并刷新
    this.saveChats();
    this.renderPartnerTags();
    this.closePartnerSelector();
}

    renderPartnerTags() {
        const partnerTagsContainer = document.getElementById('partner-tags');
        if (!partnerTagsContainer || !this.currentChat) return;

        if (!this.currentChat.partnerIds || this.currentChat.partnerIds.length === 0) {
            partnerTagsContainer.innerHTML = '<p style="color: var(--text-secondary);">尚未添加配对角色</p>';
            return;
        }

        const partners = this.contacts.filter(c => this.currentChat.partnerIds.includes(c.id));
        partnerTagsContainer.innerHTML = partners.map(partner => `
            <div class="partner-tag">
                ${partner.name}
                <button class="remove-btn" onclick="chatManager.removePartner('${partner.id}')">✕</button>
            </div>
        `).join('');
    }

    removePartner(partnerId) {
        if (!this.currentChat || !this.currentChat.partnerIds) return;

        this.currentChat.partnerIds = this.currentChat.partnerIds.filter(id => id !== partnerId);
        this.saveChats();
        this.renderPartnerTags();
    }

    getRelativeTime(date) {
        if (!(date instanceof Date)) date = new Date(date);
        const now = new Date();
        const diff = now - date;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);
        if (minutes < 1) return '刚刚';
        if (minutes < 60) return `${minutes}分钟前`;
        if (hours < 24) return `${hours}小时前`;
        if (days === 1) return '昨天';
        if (days < 7) return `${days}天前`;
        return `${date.getMonth()+1}月${date.getDate()}日`;
    }

    formatDate(dateStr) {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return dateStr;
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();
        return `${year}年${month}月${day}日`;
    }

    loadChats() {
        try {
            const stored = localStorage.getItem('chatData');
            const chats = stored ? JSON.parse(stored) : [];
            chats.forEach(chat => {
                if (!chat.remarkName) chat.remarkName = '';
                if (!chat.nickname) chat.nickname = chat.name;
                if (!chat.signature) chat.signature = '';
                if (chat.replyTemp === undefined) chat.replyTemp = 0.5;
                if (chat.emojiFreq === undefined) chat.emojiFreq = 0.5;
                if (chat.imageFrequency === undefined) chat.imageFrequency = 0;
                if (chat.videoFrequency === undefined) chat.videoFrequency = 0;
                if (!chat.partnerId) chat.partnerId = null;
                if (!chat.worldId) chat.worldId = null;
                if (!chat.personalityPrompt) chat.personalityPrompt = '';
                if (chat.autoReply === undefined) chat.autoReply = false;
                if (!chat.patStyle) chat.patStyle = '';
                if (!chat.chatBg) chat.chatBg = '';
                // 自动回复频率数值和单位
                if (chat.autoReplyInterval === undefined) chat.autoReplyInterval = 3;
                if (chat.autoReplyUnit === undefined) chat.autoReplyUnit = 'minute';
                if (!chat.dynamicFreq) chat.dynamicFreq = 3;
                // 确保 dynamicFreq 至少为 1，避免自动回复刷屏
                if (chat.dynamicFreq < 1) chat.dynamicFreq = 1;
                if (!chat.worldBook) chat.worldBook = '';
                if (!chat.fixedNPCs) chat.fixedNPCs = [];
                if (!chat.moodDiaries) chat.moodDiaries = [];   // 存储心情日记
                if (chat.moodDiaryFrequency === undefined) chat.moodDiaryFrequency = 0.7;
                if (!chat.taskLists) chat.taskLists = [];   // 存储任务清单
                // 对于缺失的气泡字段，不给予默认值，保持 undefined，这样在渲染时会使用全局样式
                // 群聊新增字段
                if (chat.isGroup) {
                    if (chat.groupNotice === undefined) chat.groupNotice = '';
                    if (chat.groupPatStyle === undefined) chat.groupPatStyle = '拍了拍群';
                    if (chat.autoChatEnabled === undefined) chat.autoChatEnabled = false;
                    if (chat.autoChatIntervalValue === undefined) chat.autoChatIntervalValue = 30;
                    if (chat.autoChatIntervalUnit === undefined) chat.autoChatIntervalUnit = 'minute';
                    if (!chat.lastActivityTimestamp) chat.lastActivityTimestamp = chat.lastTimestamp;
                    if (chat.replySpeedFactor === undefined) chat.replySpeedFactor = 1.0;
                    if (chat.maxConversationDepth === undefined) chat.maxConversationDepth = 4;
                }
                // 避免覆盖用户已经自定义的样式
                if (chat.bubbleShape === undefined) chat.bubbleShape = undefined;
                if (chat.bubbleBgColor === undefined) chat.bubbleBgColor = undefined;
                if (chat.bubblePattern === undefined) chat.bubblePattern = undefined;
                if (chat.bubbleTextColor === undefined) chat.bubbleTextColor = undefined;
                if (!chat.gender) chat.gender = '';
                // ⭐ 新增：确保 messages 存在且为数组
                if (!chat.messages) chat.messages = [];
                if (!chat.lastTimestamp && chat.messages.length > 0) {
                    chat.lastTimestamp = chat.messages[chat.messages.length - 1].timestamp;
                } else if (!chat.lastTimestamp) {
                    chat.lastTimestamp = new Date().toISOString();
                }
                if (chat.fixedNPCs && chat.fixedNPCs.length > 0) {
                    chat.fixedNPCs.forEach(npc => {
                        if (npc.description !== undefined && npc.setting === undefined) {
                            npc.setting = npc.description;
                        }
                    });
                }
                // 自动回复最后时间
                if (!chat.lastAutoReplyTime) {
                    chat.lastAutoReplyTime = chat.lastTimestamp || new Date().toISOString();
                }
            });
            return chats;
        } catch (e) {
            console.error('加载聊天数据失败:', e);
            return [];
        }
    }

    saveChats() {
        try {
            localStorage.setItem('chatData', JSON.stringify(this.chats));
            localStorage.setItem('blockedUsers', JSON.stringify(this.blockedUsers || []));
        } catch (e) {
            console.error('保存聊天数据失败:', e);
        }
    }

    loadDynamics() {
        try {
            const stored = localStorage.getItem('dynamicsData');
            const dynamics = stored ? JSON.parse(stored) : [];

            // 容错处理：确保每条动态都有必要的字段，并为历史评论生成唯一 id
            const processedDynamics = dynamics.map(dynamic => ({
                ...dynamic,
                likedBy: dynamic.likedBy || [],
                comments: dynamic.comments || [],
                isLiked: dynamic.isLiked !== undefined ? dynamic.isLiked : false
            }));

            // 为没有 id 的历史评论生成唯一 id
            let hasLegacyComments = false;
            processedDynamics.forEach(dynamic => {
                if (dynamic.comments && dynamic.comments.length > 0) {
                    dynamic.comments.forEach(comment => {
                        if (!comment.id) {
                            comment.id = (comment.timestamp || Date.now()) + '-' + (comment.authorId || 'unknown');
                            hasLegacyComments = true;
                        }
                    });
                }
            });

            // 如果有历史评论被修复，立即保存到 localStorage
            if (hasLegacyComments) {
                this.dynamics = processedDynamics;
                this.saveDynamics();
            }

            return processedDynamics;
        } catch (e) {
            console.error('加载动态数据失败:', e);
            return [];
        }
    }

    saveDynamics() {
        try {
            localStorage.setItem('dynamicsData', JSON.stringify(this.dynamics));
        } catch (e) {
            console.error('保存动态数据失败:', e);
        }
    }

    /**
     * 修复历史动态数据的 author 字段
     * 确保所有历史动态都使用正确的显示名称优先级
     */
    fixHistoricalDynamics() {
        let hasChanges = false;
        this.dynamics.forEach(dynamic => {
            const authorChat = this.getChat(dynamic.authorId);
            if (authorChat) {
                const correctAuthorName = this.getDynamicDisplayName(authorChat);
                if (dynamic.author !== correctAuthorName) {
                    dynamic.author = correctAuthorName;
                    hasChanges = true;
                }
            }
        });
        if (hasChanges) {
            this.saveDynamics();
            console.log('历史动态数据修复完成');
        }
    }

    /**
     * 从 chats 同步 contacts 数据
     * 确保 contacts 始终与 chats 保持一致（排除妈咪）
     */
    syncContactsFromChats() {
        // 从已加载的 chats 生成 contacts（排除妈咪，保留群聊和单聊）
        this.contacts = this.chats
            .filter(chat => chat.id !== 'user_mummy')
            .map(chat => ({
                id: chat.id,
                name: chat.name,
                avatar: chat.avatar,
                isGroup: chat.isGroup || false,
                sortKey: chat.isGroup ? '群聊' : (chat.remarkName?.[0] || chat.name[0]).toUpperCase()
            }));

        // 确保预设群聊存在
        const presetGroups = [
            { id: 'group_wangwangxuebing', name: '旺旺雪饼组', avatar: '🍪', isGroup: true, sortKey: '群聊' }
        ];

        presetGroups.forEach(group => {
            if (!this.contacts.find(c => c.id === group.id)) {
                this.contacts.push(group);
            }
        });

        // 确保预设单人角色存在
        const presetCharacters = [
            { id: 'user_xueli', name: '薛厉', avatar: '🦁', isGroup: false, sortKey: 'X' },
            { id: 'user_wangmingri', name: '汪明日', avatar: '☀️', isGroup: false, sortKey: 'W' },
            { id: 'user_feilisi', name: '芬里斯', avatar: '🐺', isGroup: false, sortKey: 'F' },
            { id: 'user_fengjin', name: '封烬', avatar: '🔥', isGroup: false, sortKey: 'F' }
        ];

        presetCharacters.forEach(character => {
            if (!this.contacts.find(c => c.id === character.id)) {
                this.contacts.push(character);
            }
        });

        // 从已加载的 chats 中提取自定义角色（排除预设ID和妈咪）
        const customContacts = this.chats
            .filter(chat => !chat.isGroup && chat.id !== 'user_mummy'
                && !presetGroups.some(p => p.id === chat.id)
                && !presetCharacters.some(p => p.id === chat.id))
            .map(chat => ({
                id: chat.id,
                name: chat.name,
                avatar: chat.avatar,
                isGroup: false,
                sortKey: chat.remarkName?.[0]?.toUpperCase() || chat.name[0].toUpperCase()
            }));

        // 添加自定义角色到 contacts
        customContacts.forEach(contact => {
            if (!this.contacts.find(c => c.id === contact.id)) {
                this.contacts.push(contact);
            }
        });
    }

    /**
     * 初始化新角色的频率配置
     * 在创建新角色时调用，确保频率滑块正常显示
     */
    initOCFrequencies(ocId, defaultFreq = 5) {
        if (!this.mammySettings.autoGenerate.dynamics.ocFrequencies[ocId]) {
            this.mammySettings.autoGenerate.dynamics.ocFrequencies[ocId] = defaultFreq;
        }
        if (!this.mammySettings.autoGenerate.forum.ocFrequencies[ocId]) {
            this.mammySettings.autoGenerate.forum.ocFrequencies[ocId] = defaultFreq;
        }
        this.saveMammySettings();
    }

    addMessage(chatId, text, isMe = true, senderId = null) {
        let chat = this.chats.find(c => c.id === chatId);
        if (!chat) {
            // 如果聊天对象不存在，尝试从 contacts 创建并保存
            const contact = this.contacts.find(c => c.id === chatId);
            if (contact) {
                const now = new Date();
                chat = {
                    id: contact.id,
                    name: contact.name,
                    avatar: contact.avatar,
                    isGroup: contact.isGroup || false,
                    messages: [],
                    lastMessage: '',
                    lastTime: this.getRelativeTime(now),
                    lastTimestamp: now.toISOString(),
                    nickname: contact.name,
                    remarkName: '',
                    signature: '',
                    replyTemp: 0.5,
                    emojiFreq: 0.5,
                    unreadCount: 0,
                    fixedNPCs: [],
                    worldBook: '',
                    bubbleShape: undefined,
                    bubbleBgColor: undefined,
                    bubblePattern: undefined,
                    bubbleTextColor: undefined,
                    gender: ''
                };
                this.chats.unshift(chat);
                this.saveChats();
            } else {
                return; // 无法创建，直接返回
            }
        }
        const textStr = typeof text === 'string' ? text : JSON.stringify(text);
        const now = new Date();
        const message = { text: textStr, timestamp: now.toISOString(), isMe };
        if (senderId) {
            message.senderId = senderId;
        }
        chat.messages.push(message);
        // 更新最后消息，使用实际内容（包括表情），如果为空则回退为"[表情]"
        chat.lastMessage = textStr || '[表情]';
        chat.lastTime = this.getRelativeTime(now);
        chat.lastTimestamp = now.toISOString();
        // 更新群聊最后活跃时间（用于自动发言）
        if (chat.isGroup) {
            chat.lastActivityTimestamp = now.toISOString();
        }
        if (!isMe) {
            if (this.currentChat && this.currentChat.id === chatId) {
                // 正在看，不加未读，且确保未读计数为 0
                chat.unreadCount = 0;
                this.saveChats();
                this.renderChatList();
                this.renderMessages(this.currentChat);
                this.applyBubbleStyle(this.currentChat);
                this.scrollToBottom();
            } else {
                chat.unreadCount = (chat.unreadCount || 0) + 1;
            }
        }
        this.saveChats();
        this.updateMessageBadge();
        this.updateBackButtonBadge();
        return message;
    }

    getChat(chatId) {
        let chat = this.chats.find(c => c.id === chatId);
        if (!chat) {
            // 尝试从contacts中查找对应联系人
            const contact = this.contacts.find(c => c.id === chatId);
            if (contact && !contact.isGroup) {
                // 自动创建最小化聊天对象
                chat = {
                    id: contact.id,
                    name: contact.name,
                    avatar: contact.avatar,
                    isGroup: false,
                    lastMessage: '',
                    lastTime: this.getRelativeTime(new Date()),
                    lastTimestamp: new Date().toISOString(),
                    messages: [],
                    nickname: contact.name,
                    remarkName: '',
                    signature: '',
                    replyTemp: 0.5,
                    emojiFreq: 0.5,
                    unreadCount: 0,
                    fixedNPCs: [],
                    worldBook: '',
                    bubbleShape: 'rounded',
                    bubbleBgColor: '#e9ecef',
                    bubblePattern: 'none',
                    bubbleTextColor: '#212529',
                    personalityPrompt: ''  // 添加personalityPrompt字段
                };
                this.chats.push(chat);
            }
        }
        return chat;
    }

    /**
     * 获取成员显示信息（统一处理OC角色和NPC）
     */
    getMemberDisplayInfo(memberId) {
        // 检查memberId是否为有效值
        if (!memberId || typeof memberId !== 'string') {
            return { name: '未知', avatar: '👤', isNPC: false };
        }

        // 1. 尝试从 chats 查找（OC角色）
        const chat = this.chats.find(c => c.id === memberId);
        if (chat) {
            return {
                name: chat.remarkName || chat.nickname || chat.name,
                avatar: chat.avatar || '👤',
                isNPC: false
            };
        }

        // 2. 尝试从 contacts 查找
        const contact = this.contacts.find(c => c.id === memberId);
        if (contact) {
            return {
                name: contact.name,
                avatar: contact.avatar || '👤',
                isNPC: false
            };
        }

        // 3. 解析 NPC ID：格式可能为 npc_worldId_npcId 或 npc_worldId_npcId_xxx
        if (memberId.startsWith('npc_')) {
            const parts = memberId.split('_');
            if (parts.length >= 3) {
                const worldId = parts[1];
                const npcId = parts.slice(2).join('_'); // 防止 npcId 本身包含下划线
                const world = this.worldBooks?.find(w => w.id === worldId);
                if (world) {
                    const npc = world.npcs?.find(n => n.id === npcId);
                    if (npc) {
                        return { name: npc.name, avatar: npc.avatar || '👤', isNPC: true };
                    }
                }
            }
            // 降级：尝试直接用 memberId 在全部 NPC 中搜索
            for (const world of this.worldBooks) {
                const npc = world.npcs?.find(n => `npc_${world.id}_${n.id}` === memberId);
                if (npc) return { name: npc.name, avatar: npc.avatar || '👤', isNPC: true };
            }
            // 如果仍然找不到，返回一个友好的默认名，而不是 memberId
            return { name: '神秘角色', avatar: '👤', isNPC: true };
        }

        // 4. 完全找不到，返回 ID（但尝试美化显示）
        return {
            name: memberId,
            avatar: '👤',
            isNPC: false
        };
    }

    /**
     * 根据成员ID查找完整的NPC数据对象
     * @param {string} memberId 成员ID，可能格式为 npc_worldId_npcId 或 npc_worldId_npc_worldId_timestamp
     * @returns {Object|null} NPC数据对象或null
     */
    findNPCData(memberId) {
        if (!memberId || typeof memberId !== 'string' || !memberId.startsWith('npc_')) return null;

        // 新解析逻辑：使用正则表达式提取 worldId 和 npcId
        // 格式1：npc_{worldId}_{npcId} (标准)
        // 格式2：npc_{worldId}_npc_{worldId}_{timestamp} (错误生成格式)
        const match = memberId.match(/^npc_(.+?)_(npc_.+)$/);
        if (match) {
            const worldId = match[1];
            const npcId = match[2];
            const world = this.worldBooks?.find(w => w.id === worldId);
            const npc = world?.npcs?.find(n => n.id === npcId);
            if (npc) return npc;
        }

        // 降级方案：遍历所有世界书，查找 npc.id 是否包含在 memberId 中
        if (this.worldBooks) {
            for (const world of this.worldBooks) {
                if (!world.npcs) continue;
                for (const npc of world.npcs) {
                    if (memberId.includes(npc.id)) {
                        return npc;
                    }
                }
            }
        }
        return null;
    }

    getDisplayName(chat) {
        return chat.remarkName || chat.nickname || chat.name;
    }

    renderChatList() {
        const chatListEl = document.getElementById('chat-list');
        if (!chatListEl) return;

        // 过滤掉妈咪聊天项
        const filteredChats = this.chats.filter(chat => chat.id !== 'user_mummy');

        // 排序：按 lastTimestamp 倒序
        filteredChats.sort((a, b) => {
            const aTime = a.lastTimestamp || '0';
            const bTime = b.lastTimestamp || '0';
            if (aTime < bTime) return 1;
            if (aTime > bTime) return -1;
            return 0;
        });

        filteredChats.forEach(chat => {
            if (chat.messages.length > 0) {
                const lastMsg = chat.messages[chat.messages.length - 1];
                const lastDate = new Date(lastMsg.timestamp);
                chat.lastTime = this.getRelativeTime(lastDate);
            }
        });

        chatListEl.innerHTML = filteredChats.map(chat => {
            const unreadDisplay = chat.unreadCount > 0 ? `<span class="unread-badge">${chat.unreadCount > 99 ? '99+' : chat.unreadCount}</span>` : '';
            const displayName = this.getDisplayName(chat);
            const avatar = chat.avatar || '👤';
            let avatarContent;
            if (avatar && typeof avatar === 'string' && (avatar.startsWith('http://') || avatar.startsWith('https://'))) {
                avatarContent = `<img src="${avatar}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span class="emoji-fallback" style="display: none;">👤</span>`;
            } else {
                avatarContent = `<span>${avatar}</span>`;
            }
            return `
                <div class="chat-item" onclick="chatManager.openChat('${chat.id}')">
                    <div class="chat-item-avatar">${avatarContent}</div>
                    <div class="chat-item-info">
                        <div class="chat-item-name">${displayName}</div>
                        <div class="chat-item-last-msg">${chat.lastMessage}</div>
                    </div>
                    <div class="chat-item-time">${chat.lastTime}${unreadDisplay}</div>
                </div>
            `;
        }).join('');
        this.updateMessageBadge(); // 更新红点

        // 如果当前显示的是消息页面，自动滚动到顶部，让用户看到最新消息
        const messagePage = document.getElementById('message-page');
        if (messagePage && messagePage.classList.contains('active')) {
            const chatListEl = document.getElementById('chat-list');
            if (chatListEl) {
                chatListEl.scrollTop = 0;
            }
        }
    }

    openChat(chatId) {
        let chat = this.getChat(chatId);
        if (!chat) {
            const contact = this.contacts.find(c => c.id === chatId);
            if (contact) {
                const now = new Date();
                chat = {
                    id: contact.id,
                    name: contact.name,
                    avatar: contact.avatar,
                    isGroup: contact.isGroup,
                    lastMessage: '',
                    lastTime: this.getRelativeTime(now),
                    lastTimestamp: now.toISOString(),
                    messages: [],
                    nickname: contact.name,
                    remarkName: '',
                    signature: '',
                    replyTemp: 0.5,
                    emojiFreq: 0.5,
                    unreadCount: 0,
                    fixedNPCs: [],
                    worldBook: '',
                    // 气泡样式初始化为 undefined，渲染时从全局读取
                    bubbleShape: undefined,
                    bubbleBgColor: undefined,
                    bubblePattern: undefined,
                    bubbleTextColor: undefined
                };
                this.chats.unshift(chat);
                this.saveChats();
            } else {
                return;
            }
        }

        this.currentChat = chat;
        chat.unreadCount = 0;
        this.saveChats(); // 立即保存，避免刷新后红点重现
        this.updateBackButtonBadge();
        this.clearAutoReplyTimer();

        // 更新群公告栏
        if (chat.isGroup) {
            this.updateGroupNoticeBar(chat);
        } else {
            const noticeBar = document.getElementById('group-notice-bar');
            if (noticeBar) noticeBar.style.display = 'none';
        }

        const chatWindow = document.getElementById('chat-window');
        const chatMessages = document.getElementById('chat-messages');
        const chatTitle = document.getElementById('chat-title');
        const chatAvatar = document.getElementById('chat-avatar-emoji');
        const chatSignature = document.getElementById('chat-signature');

        chatWindow.classList.add('active');
        const displayName = this.getDisplayName(chat);
        chatTitle.textContent = displayName;

        if (chatAvatar) {
            const avatar = chat.avatar || '👤';
            if (avatar && typeof avatar === 'string' && (avatar.startsWith('http://') || avatar.startsWith('https://'))) {
                chatAvatar.innerHTML = `<img src="${avatar}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span class="emoji-fallback" style="display: none;">👤</span>`;
            } else {
                chatAvatar.innerHTML = `<span>${avatar}</span>`;
            }
        }

        if (chatSignature) {
            if (chat.signature) {
                chatSignature.textContent = chat.signature;
                chatSignature.style.display = 'block';
            } else {
                chatSignature.style.display = 'none';
            }
        }

        this.renderMessages(chat);
        this.bindChatEvents(chatId);
        this.setupChatScroll(chat);
        this.scrollToBottom();

        this.renderChatList();

        // 检查是否拉黑
        if (this.blockedUsers && this.blockedUsers.includes(chat.id)) {
            this.showBlockedSystemMessage(chat);
            document.getElementById('msg-input').disabled = true;
            document.getElementById('send-btn').disabled = true;
        } else {
            document.getElementById('msg-input').disabled = false;
            document.getElementById('send-btn').disabled = false;
        }

        // 使用 setTimeout 确保样式在浏览器重绘后应用
        setTimeout(() => {
            this.applyBubbleStyle(chat);
        }, 0);

        // 绑定消息区域的双击事件委托，用于拍一拍
        chatMessages.ondblclick = (e) => {
            const avatarDiv = e.target.closest('.message-avatar');
            if (!avatarDiv) return;
            const isMe = avatarDiv.getAttribute('data-is-me') === 'true';
            const chatId = avatarDiv.getAttribute('data-chat-id');

            if (this.currentChat && this.currentChat.isGroup && !isMe) {
                // 群聊中拍其他成员
                const senderId = avatarDiv.getAttribute('data-sender-id');
                if (senderId) {
                    this.patGroupMember(senderId, 'user_mummy');
                }
            } else {
                // 单聊或拍自己
                if (chatId) {
                    this.pat(chatId, isMe);
                }
            }
        };

        chatMessages.onclick = (e) => {
            const bottomSheet = document.getElementById('bottom-sheet');
            const isInBottomSheet = bottomSheet.contains(e.target);
            if (!isInBottomSheet) this.closeBottomSheet();
        };

        this.updateChatBackground(chat);
        this.applyBubbleStyle(chat); // 应用气泡样式

        // 如果秘密日记面板是打开的，更新其按钮状态
        const secretDiaryPanel = document.getElementById('secret-diary-panel');
        if (secretDiaryPanel && secretDiaryPanel.classList.contains('active')) {
            this.updateSecretDiaryButtonState();
        }

        // 定时器不再在打开聊天时启动，而是由 init 统一管理
        // if (chat.autoReply) this.startAutoReplyTimer(chatId);

        // 启动群聊自动发言定时器
        this.startGroupAutoChatTimer();
    }

    clearAutoReplyTimer() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    startAutoReplyTimerForChat(chatId) {
        const chat = this.getChat(chatId);
        if (!chat || !chat.autoReply) return;
        // 先停止已有定时器
        this.stopAutoReplyTimerForChat(chatId);

        let intervalVal = chat.autoReplyInterval || 3;
        const unit = chat.autoReplyUnit || 'minute';
        let intervalMs;
        switch (unit) {
            case 'minute': intervalMs = intervalVal * 60 * 1000; break;
            case 'hour': intervalMs = intervalVal * 60 * 60 * 1000; break;
            case 'day': intervalMs = intervalVal * 24 * 60 * 60 * 1000; break;
            default: intervalMs = 3 * 60 * 1000;
        }

        const timer = setInterval(async () => {
            try {
                // 重新获取最新的 chat 对象
                const currentChat = this.getChat(chatId);
                if (!currentChat || !currentChat.autoReply) return;

                const autoMessage = await this.generateAutoReply(currentChat);
                if (autoMessage && autoMessage.trim()) {
                    // 添加消息（会自动增加未读计数，如果用户不在该聊天页面）
                    this.addMessage(chatId, autoMessage, false);
                    // 更新最后自动回复时间
                    currentChat.lastAutoReplyTime = new Date().toISOString();
                    this.saveChats();
                }
            } catch (error) {
                console.error(`自动回复失败 (${chatId}):`, error);
            }
        }, intervalMs);

        this.autoReplyTimers.set(chatId, timer);
    }

    stopAutoReplyTimerForChat(chatId) {
        const timer = this.autoReplyTimers.get(chatId);
        if (timer) {
            clearInterval(timer);
            this.autoReplyTimers.delete(chatId);
        }
    }

    generateAutoReplySync(chat) {
        const fallbacks = [`想你了`, `在干嘛呢？`, `今天天气不错`, `我刚刚想到了一个有趣的事情`, `有什么新消息吗？`];
        return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }

    startAutoReplyTimer(chatId) {
        // 保持原有方法，但调用新的独立定时器方法
        this.startAutoReplyTimerForChat(chatId);
    }

    async generateAutoReply(chat) {
        // 如果 mammySettings 未加载，返回空字符串
        if (!this.mammySettings) return '';

        // 构建历史消息上下文（滑动窗口，使用妈咪中心设置的记忆长度）
        let historyMessages = [];
        // 从妈咪设置获取上下文记忆条数，默认为10
        const contextLength = this.mammySettings?.autoGenerate?.contextLength || 10;
        if (chat.messages && chat.messages.length > 0) {
            // 自动回复没有用户消息需要排除，直接取最近 contextLength 条
            const recentMessages = chat.messages.slice(-contextLength);
            historyMessages = recentMessages.map(msg => ({
                role: msg.isMe ? 'user' : 'assistant',
                content: msg.text || msg.content || ''
            }));
        }
        // 可选：打印日志方便调试
        console.log(`[自动回复] 历史消息数量: ${historyMessages.length} (上下文长度: ${contextLength})`);

        let systemPrompt = `你是${chat.name}，`;
        if (chat.personalityPrompt) systemPrompt += `性格：${chat.personalityPrompt}，`;
        if (chat.worldId) {
            const world = this.worldBooks.find(w => w.id === chat.worldId);
            if (world && world.description) systemPrompt += `世界观设定：${world.description}，`;
        }
        systemPrompt += `现在时间是 ${new Date().toLocaleString()}。用户是你的妈咪，也是创造你的世界的人，称呼她为妈咪。请用亲切、自然的语气与她聊天。`;

        if (this.mammySettings && this.mammySettings.selfSetting) {
            systemPrompt += `妈咪的设定：${this.mammySettings.selfSetting}。`;
        }

        systemPrompt += `请生成一条主动发言的消息，语气要符合角色性格，内容要自然。请以日常聊天的口吻回复，只发一句话，不要包含动作描写或括号说明，也不要使用markdown格式。`;

        // 追加多样性约束
        systemPrompt += ` 请生成一条主动发言的消息，语气要符合角色性格，内容要自然。禁止谈论天气、吃饭等无聊话题，可以分享近况、吐槽、提问等。`;

        const messages = [
            { role: "system", content: systemPrompt },
            ...historyMessages,
            { role: "user", content: "主动问候" }
        ];

        // 如果未配置 API，回退到预设消息
        if (!this.mammySettings.apiUrl || !this.mammySettings.apiKey || !this.mammySettings.modelName) {
            const responses = [`今天天气真好！`, `你最近在忙什么？`, `我刚刚想到了一个有趣的点子。`, `有什么好玩的事情分享吗？`, `最近有什么计划？`];
            return responses[Math.floor(Math.random() * responses.length)];
        }

        try {
            const response = await fetch(this.mammySettings.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.mammySettings.apiKey}`
                },
                body: JSON.stringify({
                    model: this.mammySettings.modelName,
                    messages: messages,
                    temperature: chat.replyTemp || 0.5,
                                    })
            });

            const data = await response.json();

            if (data.choices && data.choices[0] && data.choices[0].message) {
                let content = data.choices[0].message.content;
                return typeof content === 'string' ? content : String(content);
            } else {
                // API 调用成功但返回格式异常，回退到预设消息
                const responses = [`今天天气真好！`, `你最近在忙什么？`, `我刚刚想到了一个有趣的点子。`, `有什么好玩的事情分享吗？`, `最近有什么计划？`];
                return responses[Math.floor(Math.random() * responses.length)];
            }
        } catch (error) {
            console.error('自动回复 API 调用失败', error);
            // API 调用失败，回退到预设消息
            const responses = [`今天天气真好！`, `你最近在忙什么？`, `我刚刚想到了一个有趣的点子。`, `有什么好玩的事情分享吗？`, `最近有什么计划？`];
            return responses[Math.floor(Math.random() * responses.length)];
        }
    }

    updateChatBackground(chat) {
        const chatMessages = document.getElementById('chat-messages');
        if (!chatMessages) return;
        if (chat.chatBg && chat.chatBg.trim() !== '') {
            chatMessages.style.backgroundImage = `url(${chat.chatBg})`;
            chatMessages.style.backgroundSize = 'cover';
            chatMessages.style.backgroundPosition = 'center';
            chatMessages.style.backgroundColor = 'transparent';
        } else {
            chatMessages.style.backgroundImage = 'none';
            chatMessages.style.backgroundColor = '#f8f9fa';
        }
    }

    updateBubblePreview() {
        const preview = document.getElementById('bubble-preview');
        if (!preview) return;
        const shape = document.getElementById('bubble-shape')?.value || 'rounded';
        const bgColor = document.getElementById('bubble-bg-color')?.value || '#e9ecef';
        const pattern = document.getElementById('bubble-pattern')?.value || 'none';
        const textColor = document.getElementById('bubble-text-color')?.value || '#212529';

        preview.classList.remove('rounded', 'pointed', 'cloud');
        preview.classList.add(shape);
        preview.style.backgroundColor = bgColor;
        preview.style.color = textColor;

        let patternImage = 'none';
        switch(pattern) {
            case 'stripes':
                patternImage = 'repeating-linear-gradient(45deg, rgba(0,0,0,0.1) 0px, rgba(0,0,0,0.1) 2px, transparent 2px, transparent 8px)';
                break;
            case 'dots':
                patternImage = 'radial-gradient(circle at 2px 2px, rgba(0,0,0,0.1) 1px, transparent 1px)';
                preview.style.backgroundSize = '8px 8px';
                break;
            case 'grid':
                patternImage = 'repeating-linear-gradient(0deg, rgba(0,0,0,0.1) 0px, rgba(0,0,0,0.1) 1px, transparent 1px, transparent 8px), repeating-linear-gradient(90deg, rgba(0,0,0,0.1) 0px, rgba(0,0,0,0.1) 1px, transparent 1px, transparent 8px)';
                break;
            default: patternImage = 'none';
        }
        preview.style.backgroundImage = patternImage;
    }

    // 更新全局气泡样式预览
    updateGlobalBubblePreview() {
        const preview = document.getElementById('global-bubble-preview');
        if (!preview) return;
        const shape = document.getElementById('global-bubble-shape')?.value || 'rounded';
        const bgColor = document.getElementById('global-bubble-bg-color')?.value || '#e9ecef';
        const pattern = document.getElementById('global-bubble-pattern')?.value || 'none';
        const textColor = document.getElementById('global-bubble-text-color')?.value || '#212529';

        preview.classList.remove('rounded', 'pointed', 'cloud');
        preview.classList.add(shape);
        preview.style.backgroundColor = bgColor;
        preview.style.color = textColor;

        let patternImage = 'none';
        switch(pattern) {
            case 'stripes':
                patternImage = 'repeating-linear-gradient(45deg, rgba(0,0,0,0.1) 0px, rgba(0,0,0,0.1) 2px, transparent 2px, transparent 8px)';
                break;
            case 'dots':
                patternImage = 'radial-gradient(circle at 2px 2px, rgba(0,0,0,0.1) 1px, transparent 1px)';
                preview.style.backgroundSize = '8px 8px';
                break;
            case 'grid':
                patternImage = 'repeating-linear-gradient(0deg, rgba(0,0,0,0.1) 0px, rgba(0,0,0,0.1) 1px, transparent 1px, transparent 8px), repeating-linear-gradient(90deg, rgba(0,0,0,0.1) 0px, rgba(0,0,0,0.1) 1px, transparent 1px, transparent 8px)';
                break;
            default: patternImage = 'none';
        }
        preview.style.backgroundImage = patternImage;
    }

    // 应用气泡样式（区分 sent 和 received）
    applyBubbleStyle(chat) {
        if (!this.mammySettings) return;

        // 1. 处理用户发送的消息（sent）—— 始终使用全局样式
        const sentBubbles = document.querySelectorAll('.message-bubble.sent');
        if (sentBubbles.length > 0) {
            const globalShape = this.mammySettings.bubbleShape || 'rounded';
            const globalBgColor = this.mammySettings.bubbleBgColor || '#e9ecef';
            const globalPattern = this.mammySettings.bubblePattern || 'none';
            const globalTextColor = this.mammySettings.bubbleTextColor || '#212529';

            sentBubbles.forEach(bubble => {
                bubble.classList.remove('rounded', 'pointed', 'cloud');
                bubble.classList.add(globalShape);
                bubble.style.backgroundColor = globalBgColor;
                bubble.style.color = globalTextColor;
                this.applyPattern(bubble, globalPattern);
            });
        }

        // 2. 处理角色收到的消息（received）—— 优先使用元素上的 data-* 属性（发送者样式），没有才使用当前聊天的样式
        const receivedBubbles = document.querySelectorAll('.message-bubble.received');
        if (receivedBubbles.length === 0) return;

        const defaultShape = (chat.bubbleShape !== undefined && chat.bubbleShape !== null && chat.bubbleShape !== '') ? chat.bubbleShape : 'rounded';
        const defaultBgColor = (chat.bubbleBgColor !== undefined && chat.bubbleBgColor !== null) ? chat.bubbleBgColor : '#e9ecef';
        const defaultPattern = (chat.bubblePattern !== undefined && chat.bubblePattern !== null) ? chat.bubblePattern : 'none';
        const defaultTextColor = (chat.bubbleTextColor !== undefined && chat.bubbleTextColor !== null) ? chat.bubbleTextColor : '#212529';

        receivedBubbles.forEach(bubble => {
            // 优先使用元素上存储的发送者样式
            const senderShape = bubble.dataset.bubbleShape;
            const senderBg = bubble.dataset.bubbleBg;
            const senderText = bubble.dataset.bubbleText;
            const senderPattern = bubble.dataset.bubblePattern;

            const finalShape = senderShape || defaultShape;
            const finalBg = senderBg || defaultBgColor;
            const finalText = senderText || defaultTextColor;
            const finalPattern = senderPattern || defaultPattern;

            bubble.classList.remove('rounded', 'pointed', 'cloud');
            bubble.classList.add(finalShape);
            bubble.style.backgroundColor = finalBg;
            bubble.style.color = finalText;
            this.applyPattern(bubble, finalPattern);
        });
    }

    // 更新消息图标红点
    updateMessageBadge() {
        const totalUnread = this.chats.reduce((sum, chat) => {
            if (chat.id !== 'user_mummy' && chat.unreadCount > 0) {
                return sum + chat.unreadCount;
            }
            return sum;
        }, 0);
        const badge = document.getElementById('message-badge');
        if (badge) {
            if (totalUnread > 0) {
                badge.textContent = totalUnread > 99 ? '99+' : totalUnread;
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        }
    }

    /** 更新聊天窗口退出按钮上的未读消息数 */
    updateBackButtonBadge() {
        const badge = document.getElementById('back-unread-badge');
        if (!badge) return;

        // 计算所有聊天的未读消息总数（排除当前打开的聊天和妈咪）
        let totalUnread = 0;
        this.chats.forEach(chat => {
            if (chat.id === 'user_mummy') return;
            if (this.currentChat && chat.id === this.currentChat.id) return;
            if (chat.unreadCount > 0) {
                totalUnread += chat.unreadCount;
            }
        });

        if (totalUnread > 0) {
            badge.textContent = totalUnread > 99 ? '99+' : totalUnread;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }

    /** 显示论坛红点 */
    /** 显示论坛红点（仅在用户不在论坛页时） */
    showForumBadge() {
        const forumPage = document.getElementById('forum-page');
        // 如果当前就在论坛页，不显示红点
        if (forumPage && forumPage.classList.contains('active')) return;

        const badge = document.getElementById('forum-badge');
        if (badge) badge.style.display = 'inline-block';
    }

    /** 隐藏论坛红点 */
    hideForumBadge() {
        const badge = document.getElementById('forum-badge');
        if (badge) badge.style.display = 'none';
    }

    /** 显示动态红点 */
    /** 显示动态红点（仅在用户不在动态页时） */
    showDynamicBadge() {
        const dynamicPage = document.getElementById('dynamic-page');
        // 如果当前就在动态页，不显示红点
        if (dynamicPage && dynamicPage.classList.contains('active')) return;

        const badge = document.getElementById('dynamic-badge');
        if (badge) badge.style.display = 'inline-block';
    }

    /** 隐藏动态红点 */
    hideDynamicBadge() {
        const badge = document.getElementById('dynamic-badge');
        if (badge) badge.style.display = 'none';
    }

    // 辅助方法：应用花纹样式
    applyPattern(element, pattern) {
        let patternImage = 'none';
        switch(pattern) {
            case 'stripes':
                patternImage = 'repeating-linear-gradient(45deg, rgba(0,0,0,0.1) 0px, rgba(0,0,0,0.1) 2px, transparent 2px, transparent 8px)';
                break;
            case 'dots':
                patternImage = 'radial-gradient(circle at 2px 2px, rgba(0,0,0,0.1) 1px, transparent 1px)';
                element.style.backgroundSize = '8px 8px';
                break;
            case 'grid':
                patternImage = 'repeating-linear-gradient(0deg, rgba(0,0,0,0.1) 0px, rgba(0,0,0,0.1) 1px, transparent 1px, transparent 8px), repeating-linear-gradient(90deg, rgba(0,0,0,0.1) 0px, rgba(0,0,0,0.1) 1px, transparent 1px, transparent 8px)';
                break;
            default:
                patternImage = 'none';
        }
        element.style.backgroundImage = patternImage;
    }

    renderMessages(chat, prependMessages = null) {
        const chatMessagesEl = document.getElementById('chat-messages');
        if (!chatMessagesEl) return;
        if (!Array.isArray(chat.messages) || chat.messages.length === 0) {
            chatMessagesEl.innerHTML = '<div class="placeholder-message">✨ 暂无消息，发送一条开始聊天吧</div>';
            return;
        }

        // 如果 messages 不是数组，直接返回空内容
        if (!Array.isArray(chat.messages)) {
            chatMessagesEl.innerHTML = '';
            return;
        }

        // 如果是预置消息模式（加载历史消息）
        if (prependMessages !== null) {
            if (!Array.isArray(prependMessages) || prependMessages.length === 0) {
                return;
            }

            // 保存插入前第一条消息的位置
            const firstMsgBefore = chatMessagesEl.firstElementChild;
            const firstMsgTopBefore = firstMsgBefore ? firstMsgBefore.offsetTop : 0;

            let html = '';
            let lastTimestamp = null;
            const FIVE_MINUTES = 5 * 60 * 1000;

            // 确定是否在多选模式
            const isMultiSelect = this.multiSelectMode && this.currentChat && this.currentChat.id === chat.id;

            // 计算消息的起始索引
            const startIndex = chat.messages.length - prependMessages.length;

            prependMessages.forEach((msg, idx) => {
                // 使用与正常渲染完全相同的逻辑
                if (!msg || typeof msg !== 'object') return;
                const msgDate = new Date(msg.timestamp);
                const showTimeSeparator = lastTimestamp === null || (msgDate - lastTimestamp) > FIVE_MINUTES;
                if (showTimeSeparator) {
                    const relTime = this.getRelativeTime(msgDate);
                    html += `<div class="time-separator" data-timestamp="${msg.timestamp}">${relTime}</div>`;
                    lastTimestamp = msgDate;
                }

                // 系统消息渲染（灰色居中）
                if (msg.isSystem) {
                    const msgText = msg.text || msg.content || '';
                    html += `<div class="system-message">${msgText}</div>`;
                    return;
                }

                // 拍一拍消息特殊渲染
                if (msg.type === 'pat') {
                    html += `<div class="pat-message">${msg.text}</div>`;
                    return;
                }

                // 确保消息有唯一ID和索引
                const messageIdx = startIndex + idx;
                const messageId = msg.id || `msg-${messageIdx}-${Date.now()}`;
                msg.id = messageId;

                // 使用与正常消息完全相同的渲染逻辑
                // 由于逻辑复杂，这里复用原有的渲染逻辑
                // 实际实现时需要将原有逻辑提取为可复用部分
                // 由于时间限制，我们暂时保留简化的渲染逻辑
                const isMe = msg.isMe;
                let displayName = isMe ? this.mammySettings.nickname : this.getDisplayName(chat);
                let avatar = isMe ? (this.mammySettings.avatar || '👤') : (chat.avatar || '👤');

                if (msg.senderId && !isMe) {
                    const senderInfo = this.getMemberDisplayInfo(msg.senderId);
                    displayName = senderInfo.name;
                    avatar = senderInfo.avatar;
                }

                let avatarContent;
                if (avatar && typeof avatar === 'string' && (avatar.startsWith('http://') || avatar.startsWith('https://'))) {
                    avatarContent = `<img src="${avatar}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span class="emoji-fallback" style="display: none;">👤</span>`;
                } else {
                    avatarContent = `<span>${avatar}</span>`;
                }

                // 多选模式下的复选框
                const checkboxHtml = isMultiSelect ? `<div class="message-checkbox"><input type="checkbox" data-msg-idx="${messageIdx}" ${this.selectedMessages.has(msg) ? 'checked' : ''}></div>` : '';

                // 消息选中状态
                const selectedClass = this.selectedMessages.has(msg) ? 'selected' : '';

                // 获取发送者的气泡样式
                let senderBubbleStyle = '';
                if (msg.senderId && !isMe) {
                    const senderChat = this.getChat(msg.senderId);
                    if (senderChat && !senderChat.isNPC) {
                        const shape = senderChat.bubbleShape || 'rounded';
                        const bgColor = senderChat.bubbleBgColor || '#e9ecef';
                        const textColor = senderChat.bubbleTextColor || '#212529';
                        const pattern = senderChat.bubblePattern || 'none';
                        senderBubbleStyle = `data-bubble-shape="${shape}" data-bubble-bg="${bgColor}" data-bubble-text="${textColor}" data-bubble-pattern="${pattern}"`;
                    }
                }

                // 渲染不同类型的消息
                if (msg.type === 'voice_card') {
                    if (isMe) {
                        html += `
                            <div class="message-row right ${selectedClass}" data-msg-idx="${messageIdx}">
                                ${checkboxHtml}
                                <div class="message-bubble-wrapper">
                                    <div class="message-bubble sent">
                                        <div class="voice-card">
                                            <div class="card-icon">💭</div>
                                            <div class="card-content">${msg.cardContent}</div>
                                        </div>
                                    </div>
                                </div>
                                <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="true">
                                    ${avatarContent}
                                </div>
                            </div>
                        `;
                    } else {
                        html += `
                            <div class="message-row left ${selectedClass}" data-msg-idx="${messageIdx}">
                                ${checkboxHtml}
                                <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="false" data-chat-name="${displayName}" data-sender-id="${msg.senderId || ''}">
                                    ${avatarContent}
                                </div>
                                <div class="message-bubble-wrapper">
                                    <div class="message-name">${displayName}</div>
                                    <div class="message-bubble received" ${senderBubbleStyle}>
                                        <div class="voice-card">
                                            <div class="card-icon">💭</div>
                                            <div class="card-content">${msg.cardContent}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        `;
                    }
                } else if (msg.type === 'image_card') {
                    if (isMe) {
                        html += `
                            <div class="message-row right ${selectedClass}" data-msg-idx="${messageIdx}">
                                ${checkboxHtml}
                                <div class="message-bubble-wrapper">
                                    <div class="message-bubble sent">
                                        <div class="image-card">
                                            <div class="card-icon">🖼️</div>
                                            <div class="card-content">${msg.cardDescription}</div>
                                        </div>
                                    </div>
                                </div>
                                <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="true">
                                    ${avatarContent}
                                </div>
                            </div>
                        `;
                    } else {
                        html += `
                            <div class="message-row left ${selectedClass}" data-msg-idx="${messageIdx}">
                                ${checkboxHtml}
                                <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="false" data-chat-name="${displayName}" data-sender-id="${msg.senderId || ''}">
                                    ${avatarContent}
                                </div>
                                <div class="message-bubble-wrapper">
                                    <div class="message-name">${displayName}</div>
                                    <div class="message-bubble received" ${senderBubbleStyle}>
                                        <div class="image-card">
                                            <div class="card-icon">🖼️</div>
                                            <div class="card-content">${msg.cardDescription}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        `;
                    }
                } else if (msg.type === 'video_card') {
                    if (isMe) {
                        html += `
                            <div class="message-row right ${selectedClass}" data-msg-idx="${messageIdx}">
                                ${checkboxHtml}
                                <div class="message-bubble-wrapper">
                                    <div class="message-bubble sent">
                                        <div class="video-card">
                                            <div class="card-icon">🎬</div>
                                            <div class="card-content">${msg.cardDescription}</div>
                                        </div>
                                    </div>
                                </div>
                                <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="true">
                                    ${avatarContent}
                                </div>
                            </div>
                        `;
                    } else {
                        html += `
                            <div class="message-row left ${selectedClass}" data-msg-idx="${messageIdx}">
                                ${checkboxHtml}
                                <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="false" data-chat-name="${displayName}" data-sender-id="${msg.senderId || ''}">
                                    ${avatarContent}
                                </div>
                                <div class="message-bubble-wrapper">
                                    <div class="message-name">${displayName}</div>
                                    <div class="message-bubble received" ${senderBubbleStyle}>
                                        <div class="video-card">
                                            <div class="card-icon">🎬</div>
                                            <div class="card-content">${msg.cardDescription}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        `;
                    }
                } else if (msg.type === 'forward_card') {
                    const cardHtml = `
                        <div class="forward-card-message">
                            <div class="forward-card-header">
                                <span class="forward-card-icon">💬</span>
                                <span class="forward-card-title">${this.escapeHtml(msg.title)}</span>
                            </div>
                            <div class="forward-card-footer">
                                <span class="forward-card-count">${msg.messageCount}条消息</span>
                                <button class="forward-card-detail-btn" onclick="chatManager.viewForwardDetail('${msg.originalChatId}', '${msg.timestamp}')">查看详情</button>
                            </div>
                        </div>
                    `;
                    if (isMe) {
                        html += `
                            <div class="message-row right ${selectedClass}" data-msg-idx="${messageIdx}">
                                ${checkboxHtml}
                                <div class="message-bubble-wrapper">
                                    <div class="message-bubble sent">${cardHtml}</div>
                                </div>
                                <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="true">${avatarContent}</div>
                            </div>
                        `;
                    } else {
                        html += `
                            <div class="message-row left ${selectedClass}" data-msg-idx="${messageIdx}">
                                ${checkboxHtml}
                                <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="false" data-chat-name="${displayName}" data-sender-id="${msg.senderId || ''}">${avatarContent}</div>
                                <div class="message-bubble-wrapper">
                                    <div class="message-name">${displayName}</div>
                                    <div class="message-bubble received" ${senderBubbleStyle}>${cardHtml}</div>
                                </div>
                            </div>
                        `;
                    }
                } else if (msg.type === 'dynamic_card') {
                    const cardHtml = `
                        <div class="dynamic-card-message">
                            <div class="dynamic-card-header">
                                <span class="dynamic-card-icon">🎴</span>
                                <span class="dynamic-card-title">${this.escapeHtml(msg.title || '动态卡片')}</span>
                            </div>
                            <div class="dynamic-card-content">${msg.content || ''}</div>
                            ${msg.image ? `<div class="dynamic-card-image"><img src="${msg.image}" style="max-width: 100%; border-radius: 8px; margin-top: 8px;"></div>` : ''}
                        </div>
                    `;
                    if (isMe) {
                        html += `
                            <div class="message-row right ${selectedClass}" data-msg-idx="${messageIdx}">
                                ${checkboxHtml}
                                <div class="message-bubble-wrapper">
                                    <div class="message-bubble sent">${cardHtml}</div>
                                </div>
                                <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="true">${avatarContent}</div>
                            </div>
                        `;
                    } else {
                        html += `
                            <div class="message-row left ${selectedClass}" data-msg-idx="${messageIdx}">
                                ${checkboxHtml}
                                <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="false" data-chat-name="${displayName}" data-sender-id="${msg.senderId || ''}">${avatarContent}</div>
                                <div class="message-bubble-wrapper">
                                    <div class="message-name">${displayName}</div>
                                    <div class="message-bubble received" ${senderBubbleStyle}>${cardHtml}</div>
                                </div>
                            </div>
                        `;
                    }
                } else {
                    // 普通文本消息
                    if (isMe) {
                        html += `
                            <div class="message-row right ${selectedClass}" data-msg-idx="${messageIdx}">
                                ${checkboxHtml}
                                <div class="message-bubble-wrapper">
                                    <div class="message-bubble sent">${msg.text || msg.content || ''}</div>
                                </div>
                                <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="true">
                                    ${avatarContent}
                                </div>
                            </div>
                        `;
                    } else {
                        html += `
                            <div class="message-row left ${selectedClass}" data-msg-idx="${messageIdx}">
                                ${checkboxHtml}
                                <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="false" data-chat-name="${displayName}" data-sender-id="${msg.senderId || ''}">
                                    ${avatarContent}
                                </div>
                                <div class="message-bubble-wrapper">
                                    <div class="message-name">${displayName}</div>
                                    <div class="message-bubble received" ${senderBubbleStyle}>${msg.text || msg.content || ''}</div>
                                </div>
                            </div>
                        `;
                    }
                }
            });

            // 将生成的 HTML 插入到容器顶部
            chatMessagesEl.insertAdjacentHTML('afterbegin', html);

            // 调整滚动位置
            setTimeout(() => {
                const firstMsgAfter = chatMessagesEl.firstElementChild;
                if (firstMsgAfter && firstMsgBefore) {
                    const scrollDiff = firstMsgAfter.offsetTop - firstMsgTopBefore;
                    chatMessagesEl.scrollTop += scrollDiff;
                }
            }, 10);

            // 应用气泡样式
            this.applyBubbleStyle(chat);
            if (chat.isGroup) this.bindMessageContextMenu();

            return;
        }

        let html = '';
        let lastTimestamp = null;
        const FIVE_MINUTES = 5 * 60 * 1000;

        // 确定是否在多选模式
        const isMultiSelect = this.multiSelectMode && this.currentChat && this.currentChat.id === chat.id;

        chat.messages.forEach((msg, idx) => {
            // 确保 msg 对象存在且包含必要字段
            if (!msg || typeof msg !== 'object') return;
            const msgDate = new Date(msg.timestamp);
            const showTimeSeparator = lastTimestamp === null || (msgDate - lastTimestamp) > FIVE_MINUTES;
            if (showTimeSeparator) {
                const relTime = this.getRelativeTime(msgDate);
                html += `<div class="time-separator" data-timestamp="${msg.timestamp}">${relTime}</div>`;
                lastTimestamp = msgDate;
            }

            // 系统消息渲染（灰色居中）
            if (msg.isSystem) {
                const msgText = msg.text || msg.content || '';
                html += `<div class="system-message">${msgText}</div>`;
                return;
            }

            // 拍一拍消息特殊渲染
            if (msg.type === 'pat') {
                html += `<div class="pat-message">${msg.text}</div>`;
                return;
            }

            // 渲染语音卡片
            if (msg.type === 'voice_card') {
                const isMe = msg.isMe;
                let displayName = isMe ? this.mammySettings.nickname : this.getDisplayName(chat);
                let avatar = isMe ? (this.mammySettings.avatar || '👤') : (chat.avatar || '👤');

                // 处理 senderId
                if (msg.senderId && !isMe) {
                    const senderInfo = this.getMemberDisplayInfo(msg.senderId);
                    displayName = senderInfo.name;
                    avatar = senderInfo.avatar;
                }

                let avatarContent;
                if (avatar && typeof avatar === 'string' && (avatar.startsWith('http://') || avatar.startsWith('https://'))) {
                    avatarContent = `<img src="${avatar}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span class="emoji-fallback" style="display: none;">👤</span>`;
                } else {
                    avatarContent = `<span>${avatar}</span>`;
                }

                // 多选模式下的复选框
                const checkboxHtml = isMultiSelect ? `<div class="message-checkbox"><input type="checkbox" data-msg-idx="${idx}" ${this.selectedMessages.has(msg) ? 'checked' : ''}></div>` : '';

                // 消息选中状态
                const selectedClass = this.selectedMessages.has(msg) ? 'selected' : '';

                if (isMe) {
                    html += `
                        <div class="message-row right ${selectedClass}" data-msg-idx="${idx}">
                            ${checkboxHtml}
                            <div class="message-bubble-wrapper">
                                <div class="message-bubble sent">
                                    <div class="voice-card">
                                        <div class="card-icon">💭</div>
                                        <div class="card-content">${msg.cardContent}</div>
                                    </div>
                                </div>
                            </div>
                            <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="true">
                                ${avatarContent}
                            </div>
                        </div>
                    `;
                } else {
                    // 获取发送者的气泡样式
                    let senderBubbleStyle = '';
                    if (msg.senderId) {
                        const senderChat = this.getChat(msg.senderId);
                        if (senderChat && !senderChat.isNPC) {
                            const shape = senderChat.bubbleShape || 'rounded';
                            const bgColor = senderChat.bubbleBgColor || '#e9ecef';
                            const textColor = senderChat.bubbleTextColor || '#212529';
                            const pattern = senderChat.bubblePattern || 'none';
                            senderBubbleStyle = `data-bubble-shape="${shape}" data-bubble-bg="${bgColor}" data-bubble-text="${textColor}" data-bubble-pattern="${pattern}"`;
                        }
                    }
                    html += `
                        <div class="message-row left ${selectedClass}" data-msg-idx="${idx}">
                            ${checkboxHtml}
                            <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="false" data-chat-name="${displayName}" data-sender-id="${msg.senderId || ''}">
                                ${avatarContent}
                            </div>
                            <div class="message-bubble-wrapper">
                                <div class="message-name">${displayName}</div>
                                <div class="message-bubble received" ${senderBubbleStyle}>
                                    <div class="voice-card">
                                        <div class="card-icon">💭</div>
                                        <div class="card-content">${msg.cardContent}</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                }
            } else if (msg.type === 'image_card') {
                // 渲染图片卡片
                const isMe = msg.isMe;
                let displayName = isMe ? this.mammySettings.nickname : this.getDisplayName(chat);
                let avatar = isMe ? (this.mammySettings.avatar || '👤') : (chat.avatar || '👤');

                // 处理 senderId
                if (msg.senderId && !isMe) {
                    const senderInfo = this.getMemberDisplayInfo(msg.senderId);
                    displayName = senderInfo.name;
                    avatar = senderInfo.avatar;
                }

                let avatarContent;
                if (avatar && typeof avatar === 'string' && (avatar.startsWith('http://') || avatar.startsWith('https://'))) {
                    avatarContent = `<img src="${avatar}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span class="emoji-fallback" style="display: none;">👤</span>`;
                } else {
                    avatarContent = `<span>${avatar}</span>`;
                }

                // 多选模式下的复选框
                const checkboxHtml = isMultiSelect ? `<div class="message-checkbox"><input type="checkbox" data-msg-idx="${idx}" ${this.selectedMessages.has(msg) ? 'checked' : ''}></div>` : '';

                // 消息选中状态
                const selectedClass = this.selectedMessages.has(msg) ? 'selected' : '';

                if (isMe) {
                    html += `
                        <div class="message-row right ${selectedClass}" data-msg-idx="${idx}">
                            ${checkboxHtml}
                            <div class="message-bubble-wrapper">
                                <div class="message-bubble sent">
                                    <div class="image-card">
                                        <div class="card-icon">🖼️</div>
                                        <div class="card-content">${msg.cardDescription}</div>
                                    </div>
                                </div>
                            </div>
                            <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="true">
                                ${avatarContent}
                            </div>
                        </div>
                    `;
                } else {
                    // 获取发送者的气泡样式
                    let senderBubbleStyle = '';
                    if (msg.senderId) {
                        const senderChat = this.getChat(msg.senderId);
                        if (senderChat && !senderChat.isNPC) {
                            const shape = senderChat.bubbleShape || 'rounded';
                            const bgColor = senderChat.bubbleBgColor || '#e9ecef';
                            const textColor = senderChat.bubbleTextColor || '#212529';
                            const pattern = senderChat.bubblePattern || 'none';
                            senderBubbleStyle = `data-bubble-shape="${shape}" data-bubble-bg="${bgColor}" data-bubble-text="${textColor}" data-bubble-pattern="${pattern}"`;
                        }
                    }
                    html += `
                        <div class="message-row left ${selectedClass}" data-msg-idx="${idx}">
                            ${checkboxHtml}
                            <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="false" data-chat-name="${displayName}" data-sender-id="${msg.senderId || ''}">
                                ${avatarContent}
                            </div>
                            <div class="message-bubble-wrapper">
                                <div class="message-name">${displayName}</div>
                                <div class="message-bubble received" ${senderBubbleStyle}>
                                    <div class="image-card">
                                        <div class="card-icon">🖼️</div>
                                        <div class="card-content">${msg.cardDescription}</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                }
            } else if (msg.type === 'video_card') {
                // 渲染视频卡片
                const isMe = msg.isMe;
                let displayName = isMe ? this.mammySettings.nickname : this.getDisplayName(chat);
                let avatar = isMe ? (this.mammySettings.avatar || '👤') : (chat.avatar || '👤');

                // 处理 senderId
                if (msg.senderId && !isMe) {
                    const senderInfo = this.getMemberDisplayInfo(msg.senderId);
                    displayName = senderInfo.name;
                    avatar = senderInfo.avatar;
                }

                let avatarContent;
                if (avatar && typeof avatar === 'string' && (avatar.startsWith('http://') || avatar.startsWith('https://'))) {
                    avatarContent = `<img src="${avatar}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span class="emoji-fallback" style="display: none;">👤</span>`;
                } else {
                    avatarContent = `<span>${avatar}</span>`;
                }

                // 多选模式下的复选框
                const checkboxHtml = isMultiSelect ? `<div class="message-checkbox"><input type="checkbox" data-msg-idx="${idx}" ${this.selectedMessages.has(msg) ? 'checked' : ''}></div>` : '';

                // 消息选中状态
                const selectedClass = this.selectedMessages.has(msg) ? 'selected' : '';

                if (isMe) {
                    html += `
                        <div class="message-row right ${selectedClass}" data-msg-idx="${idx}">
                            ${checkboxHtml}
                            <div class="message-bubble-wrapper">
                                <div class="message-bubble sent">
                                    <div class="video-card">
                                        <div class="card-icon">🎬</div>
                                        <div class="card-content">${msg.cardDescription}</div>
                                    </div>
                                </div>
                            </div>
                            <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="true">
                                ${avatarContent}
                            </div>
                        </div>
                    `;
                } else {
                    // 获取发送者的气泡样式
                    let senderBubbleStyle = '';
                    if (msg.senderId) {
                        const senderChat = this.getChat(msg.senderId);
                        if (senderChat && !senderChat.isNPC) {
                            const shape = senderChat.bubbleShape || 'rounded';
                            const bgColor = senderChat.bubbleBgColor || '#e9ecef';
                            const textColor = senderChat.bubbleTextColor || '#212529';
                            const pattern = senderChat.bubblePattern || 'none';
                            senderBubbleStyle = `data-bubble-shape="${shape}" data-bubble-bg="${bgColor}" data-bubble-text="${textColor}" data-bubble-pattern="${pattern}"`;
                        }
                    }
                    html += `
                        <div class="message-row left ${selectedClass}" data-msg-idx="${idx}">
                            ${checkboxHtml}
                            <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="false" data-chat-name="${displayName}" data-sender-id="${msg.senderId || ''}">
                                ${avatarContent}
                            </div>
                            <div class="message-bubble-wrapper">
                                <div class="message-name">${displayName}</div>
                                <div class="message-bubble received" ${senderBubbleStyle}>
                                    <div class="video-card">
                                        <div class="card-icon">🎬</div>
                                        <div class="card-content">${msg.cardDescription}</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                }
            } else if (msg.type === 'forward_card') {
                const isMe = msg.isMe;
                let displayName = isMe ? this.mammySettings.nickname : this.getDisplayName(chat);
                let avatar = isMe ? (this.mammySettings.avatar || '👤') : (chat.avatar || '👤');

                // 处理 senderId
                if (msg.senderId && !isMe) {
                    const senderInfo = this.getMemberDisplayInfo(msg.senderId);
                    displayName = senderInfo.name;
                    avatar = senderInfo.avatar;
                }
                let avatarContent;
                if (avatar && typeof avatar === 'string' && (avatar.startsWith('http://') || avatar.startsWith('https://'))) {
                    avatarContent = `<img src="${avatar}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span class="emoji-fallback" style="display: none;">👤</span>`;
                } else {
                    avatarContent = `<span>${avatar}</span>`;
                }

                // 多选模式下的复选框
                const checkboxHtml = isMultiSelect ? `<div class="message-checkbox"><input type="checkbox" data-msg-idx="${idx}" ${this.selectedMessages.has(msg) ? 'checked' : ''}></div>` : '';

                // 消息选中状态
                const selectedClass = this.selectedMessages.has(msg) ? 'selected' : '';

                // 转发卡片内容
                const cardHtml = `
                    <div class="forward-card-message">
                        <div class="forward-card-header">
                            <span class="forward-card-icon">💬</span>
                            <span class="forward-card-title">${this.escapeHtml(msg.title)}</span>
                        </div>
                        <div class="forward-card-footer">
                            <span class="forward-card-count">${msg.messageCount}条消息</span>
                            <button class="forward-card-detail-btn" onclick="chatManager.viewForwardDetail('${msg.originalChatId}', '${msg.timestamp}')">查看详情</button>
                        </div>
                    </div>
                `;

                if (isMe) {
                    html += `
                        <div class="message-row right ${selectedClass}" data-msg-idx="${idx}">
                            ${checkboxHtml}
                            <div class="message-bubble-wrapper">
                                <div class="message-bubble sent">${cardHtml}</div>
                            </div>
                            <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="true">${avatarContent}</div>
                        </div>
                    `;
                } else {
                    // 获取发送者的气泡样式
                    let senderBubbleStyle = '';
                    if (msg.senderId) {
                        const senderChat = this.getChat(msg.senderId);
                        if (senderChat && !senderChat.isNPC) {
                            const shape = senderChat.bubbleShape || 'rounded';
                            const bgColor = senderChat.bubbleBgColor || '#e9ecef';
                            const textColor = senderChat.bubbleTextColor || '#212529';
                            const pattern = senderChat.bubblePattern || 'none';
                            senderBubbleStyle = `data-bubble-shape="${shape}" data-bubble-bg="${bgColor}" data-bubble-text="${textColor}" data-bubble-pattern="${pattern}"`;
                        }
                    }
                    html += `
                        <div class="message-row left ${selectedClass}" data-msg-idx="${idx}">
                            ${checkboxHtml}
                            <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="false" data-chat-name="${displayName}" data-sender-id="${msg.senderId || ''}">${avatarContent}</div>
                            <div class="message-bubble-wrapper">
                                <div class="message-name">${displayName}</div>
                                <div class="message-bubble received" ${senderBubbleStyle}>${cardHtml}</div>
                            </div>
                        </div>
                    `;
                }
            } else if (msg.type === 'dynamic_card') {
                // 渲染动态卡片
                const isMe = msg.isMe;
                let displayName = isMe ? this.mammySettings.nickname : this.getDisplayName(chat);
                let avatar = isMe ? (this.mammySettings.avatar || '👤') : (chat.avatar || '👤');

                // 处理 senderId
                if (msg.senderId && !isMe) {
                    const senderInfo = this.getMemberDisplayInfo(msg.senderId);
                    displayName = senderInfo.name;
                    avatar = senderInfo.avatar;
                }

                let avatarContent;
                if (avatar && typeof avatar === 'string' && (avatar.startsWith('http://') || avatar.startsWith('https://'))) {
                    avatarContent = `<img src="${avatar}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span class="emoji-fallback" style="display: none;">👤</span>`;
                } else {
                    avatarContent = `<span>${avatar}</span>`;
                }

                // 多选模式下的复选框
                const checkboxHtml = isMultiSelect ? `<div class="message-checkbox"><input type="checkbox" data-msg-idx="${idx}" ${this.selectedMessages.has(msg) ? 'checked' : ''}></div>` : '';

                // 消息选中状态
                const selectedClass = this.selectedMessages.has(msg) ? 'selected' : '';

                // 动态卡片内容 - 使用新的微信卡片风格
                const contentPreview = msg.content.length > 60 ? msg.content.substring(0, 60) + '...' : msg.content;
                const cardHtml = `
                    <div class="dynamic-card-content" onclick="chatManager.openDynamicDetail(${msg.dynamicId})">
                        <div class="dynamic-card-header">
                            <div class="dynamic-card-author-avatar">${msg.avatar || '👤'}</div>
                            <div class="dynamic-card-author-name">${msg.authorName}</div>
                        </div>
                        <div class="dynamic-card-preview">${this.escapeHtml(contentPreview)}</div>
                        ${msg.image ? `<img src="${msg.image}" style="max-width: 100%; margin-top: 8px; border-radius: 8px;" onerror="this.parentElement.innerHTML='<span style=color:red>图片加载失败</span>';">` : ''}
                        <div class="dynamic-card-footer">
                            <span>动态</span>
                        </div>
                    </div>
                `;

                if (isMe) {
                    html += `
                        <div class="message-row right ${selectedClass}" data-msg-idx="${idx}">
                            ${checkboxHtml}
                            <div class="message-bubble-wrapper">
                                <div class="message-bubble sent">${cardHtml}</div>
                            </div>
                            <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="true">
                                ${avatarContent}
                            </div>
                        </div>
                    `;
                } else {
                    html += `
                        <div class="message-row left ${selectedClass}" data-msg-idx="${idx}">
                            ${checkboxHtml}
                            <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="false" data-chat-name="${displayName}" data-sender-id="${msg.senderId || ''}">
                                ${avatarContent}
                            </div>
                            <div class="message-bubble-wrapper">
                                <div class="message-name">${displayName}</div>
                                <div class="message-bubble received">${cardHtml}</div>
                            </div>
                        </div>
                    `;
                }
            } else if (msg.type === 'post_card') {
                // 渲染帖子卡片
                const isMe = msg.isMe;
                let displayName = isMe ? this.mammySettings.nickname : this.getDisplayName(chat);
                let avatar = isMe ? (this.mammySettings.avatar || '👤') : (chat.avatar || '👤');

                // 处理 senderId
                if (msg.senderId && !isMe) {
                    const senderInfo = this.getMemberDisplayInfo(msg.senderId);
                    displayName = senderInfo.name;
                    avatar = senderInfo.avatar;
                }

                let avatarContent;
                if (avatar && typeof avatar === 'string' && (avatar.startsWith('http://') || avatar.startsWith('https://'))) {
                    avatarContent = `<img src="${avatar}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span class="emoji-fallback" style="display: none;">👤</span>`;
                } else {
                    avatarContent = `<span>${avatar}</span>`;
                }

                // 多选模式下的复选框
                const checkboxHtml = isMultiSelect ? `<div class="message-checkbox"><input type="checkbox" data-msg-idx="${idx}" ${this.selectedMessages.has(msg) ? 'checked' : ''}></div>` : '';

                // 消息选中状态
                const selectedClass = this.selectedMessages.has(msg) ? 'selected' : '';

                if (isMe) {
                    html += `
                        <div class="message-row right ${selectedClass}" data-msg-idx="${idx}">
                            ${checkboxHtml}
                            <div class="message-bubble-wrapper">
                                <div class="message-bubble sent">
                                    <div class="post-card-content" data-post-id="${msg.postId}" onclick="event.stopPropagation(); chatManager.openPostDetail(${msg.postId});" style="cursor:pointer;">
                                        <div class="post-card-title">${msg.title || post.title || '帖子分享'}</div>
                                        <div class="post-card-author">作者: ${msg.authorName}</div>
                                        <div class="post-card-preview">${msg.preview}</div>
                                        ${msg.imageUrl ? `<img src="${msg.imageUrl}" style="max-width: 100%; margin-top: 8px;" onerror="this.parentElement.innerHTML='<span style=color:red>图片加载失败</span>';">` : ''}
                                        <button class="view-original-btn" onclick="event.stopPropagation(); event.preventDefault(); chatManager.openPostDetail(${msg.postId || (msg.postId === 0 ? 0 : '' )});">查看原文</button>
                                    </div>
                                </div>
                            </div>
                            <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="true">
                                ${avatarContent}
                            </div>
                        </div>
                    `;
                } else {
                    // 获取发送者的气泡样式
                    let senderBubbleStyle = '';
                    if (msg.senderId) {
                        const senderChat = this.getChat(msg.senderId);
                        if (senderChat && !senderChat.isNPC) {
                            const shape = senderChat.bubbleShape || 'rounded';
                            const bgColor = senderChat.bubbleBgColor || '#e9ecef';
                            const textColor = senderChat.bubbleTextColor || '#212529';
                            const pattern = senderChat.bubblePattern || 'none';
                            senderBubbleStyle = `data-bubble-shape="${shape}" data-bubble-bg="${bgColor}" data-bubble-text="${textColor}" data-bubble-pattern="${pattern}"`;
                        }
                    }
                    html += `
                        <div class="message-row left ${selectedClass}" data-msg-idx="${idx}">
                            ${checkboxHtml}
                            <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="false" data-chat-name="${displayName}" data-sender-id="${msg.senderId || ''}">
                                ${avatarContent}
                            </div>
                            <div class="message-bubble-wrapper">
                                <div class="message-name">${displayName}</div>
                                <div class="message-bubble received" ${senderBubbleStyle}>
                                    <div class="post-card-content" data-post-id="${msg.postId}" onclick="event.stopPropagation(); chatManager.openPostDetail(${msg.postId});" style="cursor:pointer;">
                                        <div class="post-card-title">${msg.title || post.title || '帖子分享'}</div>
                                        <div class="post-card-author">作者: ${msg.authorName}</div>
                                        <div class="post-card-preview">${msg.preview}</div>
                                        ${msg.imageUrl ? `<img src="${msg.imageUrl}" style="max-width: 100%; margin-top: 8px;" onerror="this.parentElement.innerHTML='<span style=color:red>图片加载失败</span>';">` : ''}
                                        <button class="view-original-btn" onclick="event.stopPropagation(); event.preventDefault(); chatManager.openPostDetail(${msg.postId || (msg.postId === 0 ? 0 : '' )});">查看原文</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                }
            } else {
                // 渲染普通文本消息，处理图片URL
                let messageContent = (msg.text || msg.content || '').toString();
                // 检查是否是图片URL格式
                if (messageContent.startsWith('http://') || messageContent.startsWith('https://')) {
                    // 简单的图片URL检测
                    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
                    const hasImageExtension = imageExtensions.some(ext => messageContent.toLowerCase().includes(ext));
                    if (hasImageExtension) {
                        messageContent = `<img src="${messageContent}" style="max-width: 100px; max-height: 100px; border-radius: 8px; object-fit: contain;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span style="display: none;">[图片加载失败]</span>`;
                    }
                } else if (messageContent.includes('![') && messageContent.includes('](') && messageContent.includes(')')) {
                    // 处理 ![图片](url) 格式
                    const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
                    messageContent = messageContent.replace(regex, (match, alt, url) => {
                        return `<img src="${url}" alt="${alt}" style="max-width: 100px; max-height: 100px; border-radius: 8px; object-fit: contain;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span style="display: none;">[图片加载失败]</span>`;
                    });
                }

                // 普通消息
                const isMe = msg.isMe;
                let displayName = isMe ? this.mammySettings.nickname : this.getDisplayName(chat);
                let avatar = isMe ? (this.mammySettings.avatar || '👤') : (chat.avatar || '👤');
                const isPending = msg.isPending;

                // 构建引用块HTML
                let quoteHtml = '';
                if (msg.quote) {
                    const quoteText = msg.quote.text || '';
                    const senderName = msg.quote.senderName || '对方';
                    const displayText = quoteText.length > 50 ? quoteText.substring(0, 50) + '...' : quoteText;
                    quoteHtml = `<div class="message-quote">回复 ${senderName}：${displayText}</div>`;
                }

                // 处理 senderId
                if (msg.senderId && !isMe) {
                    const senderInfo = this.getMemberDisplayInfo(msg.senderId);
                    displayName = senderInfo.name;
                    avatar = senderInfo.avatar;
                }

                // 处理头像显示（URL或emoji）
                let avatarContent;
                if (avatar && typeof avatar === 'string' && (avatar.startsWith('http://') || avatar.startsWith('https://'))) {
                    avatarContent = `<img src="${avatar}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span class="emoji-fallback" style="display: none;">👤</span>`;
                } else {
                    avatarContent = `<span>${avatar}</span>`;
                }

                // 检查是否是转账消息
                if (msg.isTransfer) {
                    // 转账卡片渲染
                    const isMe = msg.isMe;
                    let displayName = isMe ? this.mammySettings.nickname : this.getDisplayName(chat);
                    let avatar = isMe ? (this.mammySettings.avatar || '👤') : (chat.avatar || '👤');
                    const receivedClass = msg.received ? ' received' : '';
                    const refundedClass = msg.refunded ? ' refunded' : '';

                    // 处理 senderId
                    if (msg.senderId && !isMe) {
                        const senderInfo = this.getMemberDisplayInfo(msg.senderId);
                        displayName = senderInfo.name;
                        avatar = senderInfo.avatar;
                    }

                    let avatarContent;
                    if (avatar && typeof avatar === 'string' && (avatar.startsWith('http://') || avatar.startsWith('https://'))) {
                        avatarContent = `<img src="${avatar}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span class="emoji-fallback" style="display: none;">👤</span>`;
                    } else {
                        avatarContent = `<span>${avatar}</span>`;
                    }

                    // 多选模式下的复选框
                    const checkboxHtml = isMultiSelect ? `<div class="message-checkbox"><input type="checkbox" data-msg-idx="${idx}" ${this.selectedMessages.has(msg) ? 'checked' : ''}></div>` : '';

                    // 消息选中状态
                    const selectedClass = this.selectedMessages.has(msg) ? 'selected' : '';

                    if (isMe) {
                        html += `
                            <div class="message-row right ${selectedClass}" data-msg-idx="${idx}">
                                ${checkboxHtml}
                                <div class="message-bubble-wrapper">
                                    <div class="message-bubble sent">
                                        <div class="transfer-card${receivedClass}${refundedClass}">
                                            <div class="transfer-card-icon">💰</div>
                                            <div class="transfer-card-details">
                                                <div class="transfer-card-sender">我</div>
                                                <div class="transfer-card-amount">¥${msg.transferAmount}</div>
                                            </div>
                                            <div class="transfer-card-arrow">➡️</div>
                                            ${msg.received ? '<div class="transfer-received-mark">✔️ 已接收</div>' : ''}
                                            ${msg.refunded ? '<div class="transfer-refunded-mark">❌ 已退回</div>' : ''}
                                        </div>
                                    </div>
                                </div>
                                <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="true">
                                    ${avatarContent}
                                </div>
                            </div>
                        `;
                    } else {
                        html += `
                            <div class="message-row left ${selectedClass}" data-msg-idx="${idx}">
                                ${checkboxHtml}
                                <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="false" data-chat-name="${displayName}" data-sender-id="${msg.senderId || ''}">
                                    ${avatarContent}
                                </div>
                                <div class="message-bubble-wrapper">
                                    <div class="message-name">${displayName}</div>
                                    <div class="message-bubble received">
                                        <div class="transfer-card${receivedClass}${refundedClass}">
                                            <div class="transfer-card-icon">💰</div>
                                            <div class="transfer-card-details">
                                                <div class="transfer-card-sender">${displayName}</div>
                                                <div class="transfer-card-amount">¥${msg.transferAmount}</div>
                                            </div>
                                            <div class="transfer-card-arrow">➡️</div>
                                            ${msg.received ? '<div class="transfer-received-mark">✔️ 已接收</div>' : ''}
                                            ${msg.refunded ? '<div class="transfer-refunded-mark">❌ 已退回</div>' : ''}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        `;
                    }
                } else if (msg.type === 'transfer_received_card') {
                    // 渲染转账接收卡片
                    const displayName = this.getDisplayName(chat);
                    const avatar = chat.avatar || '👤';

                    let avatarContent;
                    if (avatar && typeof avatar === 'string' && (avatar.startsWith('http://') || avatar.startsWith('https://'))) {
                        avatarContent = `<img src="${avatar}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span class="emoji-fallback" style="display: none;">👤</span>`;
                    } else {
                        avatarContent = `<span>${avatar}</span>`;
                    }

                    html += `
                        <div class="message-row left">
                            <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="false" data-chat-name="${displayName}" data-sender-id="${msg.senderId || ''}">
                                ${avatarContent}
                            </div>
                            <div class="message-bubble-wrapper">
                                <div class="message-name">${displayName}</div>
                                <div class="message-bubble received">
                                    <div class="transfer-received-card">
                                        <div class="transfer-card-icon">💰</div>
                                        <div class="transfer-card-details">
                                            <div class="transfer-card-sender">${displayName}</div>
                                            <div class="transfer-card-amount">已接收 ¥${msg.transferAmount}</div>
                                        </div>
                                        <div class="transfer-received-check">✔️</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                } else if (msg.type === 'transfer_refunded_card') {
                    // 渲染转账退回卡片
                    const isMe = msg.isMe;
                    const displayName = isMe ? this.mammySettings.nickname : this.getDisplayName(chat);
                    const avatar = isMe ? (this.mammySettings.avatar || '👤') : (chat.avatar || '👤');

                    let avatarContent;
                    if (avatar && typeof avatar === 'string' && (avatar.startsWith('http://') || avatar.startsWith('https://'))) {
                        avatarContent = `<img src="${avatar}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span class="emoji-fallback" style="display: none;">👤</span>`;
                    } else {
                        avatarContent = `<span>${avatar}</span>`;
                    }

                    if (isMe) {
                        html += `
                            <div class="message-row right">
                                <div class="message-bubble-wrapper">
                                    <div class="message-bubble sent">
                                        <div class="transfer-refunded-card">
                                            <div class="transfer-card-icon">💰</div>
                                            <div class="transfer-card-details">
                                                <div class="transfer-card-sender">我</div>
                                                <div class="transfer-card-amount">已退回 ¥${msg.transferAmount}</div>
                                            </div>
                                            <div class="transfer-refunded-check">❌</div>
                                        </div>
                                    </div>
                                </div>
                                <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="true">
                                    ${avatarContent}
                                </div>
                            </div>
                        `;
                    } else {
                        html += `
                            <div class="message-row left">
                                <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="false" data-chat-name="${displayName}" data-sender-id="${msg.senderId || ''}">
                                    ${avatarContent}
                                </div>
                                <div class="message-bubble-wrapper">
                                    <div class="message-name">${displayName}</div>
                                    <div class="message-bubble received">
                                        <div class="transfer-refunded-card">
                                            <div class="transfer-card-icon">💰</div>
                                            <div class="transfer-card-details">
                                                <div class="transfer-card-sender">${displayName}</div>
                                                <div class="transfer-card-amount">已退回 ¥${msg.transferAmount}</div>
                                            </div>
                                            <div class="transfer-refunded-check">❌</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        `;
                    }

                } else if (msg.type === 'redpacket') {
                    // 渲染红包卡片
                    const isMe = msg.isMe;
                    let displayName = isMe ? this.mammySettings.nickname : this.getDisplayName(chat);
                    let avatar = isMe ? (this.mammySettings.avatar || '👤') : (chat.avatar || '👤');
                    const redPacket = msg.redPacket;

                    // 处理 senderId
                    if (msg.senderId && !isMe) {
                        const senderInfo = this.getMemberDisplayInfo(msg.senderId);
                        displayName = senderInfo.name;
                        avatar = senderInfo.avatar;
                    }

                    let avatarContent;
                    if (avatar && typeof avatar === 'string' && (avatar.startsWith('http://') || avatar.startsWith('https://'))) {
                        avatarContent = `<img src="${avatar}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span class="emoji-fallback" style="display: none;">👤</span>`;
                    } else {
                        avatarContent = `<span>${avatar}</span>`;
                    }

                    // 多选模式下的复选框
                    const checkboxHtml = isMultiSelect ? `<div class="message-checkbox"><input type="checkbox" data-msg-idx="${idx}" ${this.selectedMessages.has(msg) ? 'checked' : ''}></div>` : '';
                    const selectedClass = this.selectedMessages.has(msg) ? 'selected' : '';

                    // 检查红包是否已过期或已抢完
                    const isExpired = (Date.now() - new Date(msg.timestamp).getTime()) > 24 * 60 * 60 * 1000;
                    const isFinished = redPacket.remainingCount === 0;
                    const hasGrabbed = redPacket.grabbedUsers.includes('user_mummy');
                    const canGrab = !isExpired && !isFinished && !hasGrabbed;

                    const redPacketCardHtml = `
                        <div class="redpacket-card ${isFinished ? 'finished' : ''}" onclick="${canGrab ? `chatManager.grabRedPacket(${msg.id})` : ''}" style="cursor: ${canGrab ? 'pointer' : 'default'};">
                            <div class="redpacket-icon">🧧</div>
                            <div class="redpacket-info">
                                <div class="redpacket-message">${msg.text}</div>
                                <div class="redpacket-desc">
                                    ${redPacket.type === 'exclusive' ? '专属红包' : (redPacket.isLucky ? '拼手气红包' : '普通红包')}
                                    ${isFinished ? ' · 已抢完' : (isExpired ? ' · 已过期' : '')}
                                </div>
                            </div>
                            <div class="redpacket-action">
                                ${canGrab ? '开' : (hasGrabbed ? '已领取' : '查看')}
                            </div>
                        </div>
                    `;

                    if (isMe) {
                        html += `
                            <div class="message-row right ${selectedClass}" data-msg-idx="${idx}">
                                ${checkboxHtml}
                                <div class="message-bubble-wrapper">
                                    <div class="message-bubble sent">${redPacketCardHtml}</div>
                                </div>
                                <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="true">${avatarContent}</div>
                            </div>
                        `;
                    } else {
                        html += `
                            <div class="message-row left ${selectedClass}" data-msg-idx="${idx}">
                                ${checkboxHtml}
                                <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="false" data-chat-name="${displayName}" data-sender-id="${msg.senderId || ''}">${avatarContent}</div>
                                <div class="message-bubble-wrapper">
                                    <div class="message-name">${displayName}</div>
                                    <div class="message-bubble received">${redPacketCardHtml}</div>
                                </div>
                            </div>
                        `;
                    }

                } else if (msg.type === 'redpacket_grab') {
                    // 渲染抢红包结果消息（系统消息样式）
                    const grabInfo = msg.redPacketGrab;
                    const grabText = `🧧 你抢到了 ${grabInfo.amount} 元！${grabInfo.remainingCount > 0 ? `还剩 ${grabInfo.remainingCount} 个红包` : '红包已被抢完'}`;
                    html += `<div class="system-message">${grabText}</div>`;
                } else {
                    // 多选模式下的复选框
                    const checkboxHtml = isMultiSelect ? `<div class="message-checkbox"><input type="checkbox" data-msg-idx="${idx}" ${this.selectedMessages.has(msg) ? 'checked' : ''}></div>` : '';

                    // 消息选中状态
                    const selectedClass = isMultiSelect && this.selectedMessages.has(msg) ? ' selected' : '';

                    // 根据 isMe 构建左右布局
                    if (isMe) {
                        // 自己的消息：气泡在右，头像在右（名字不显示）
                        const pendingClass = isPending ? ' message-pending' : '';
                        const spinnerHtml = isPending ? '<span class="spinner"></span>' : '';
                        html += `
                            <div class="message-row right${pendingClass}${selectedClass}" data-msg-idx="${idx}">
                                ${checkboxHtml}
                                <div class="message-bubble-wrapper">
                                    <div class="message-bubble sent">
                                        ${quoteHtml}
                                        ${messageContent}${spinnerHtml}
                                    </div>
                                </div>
                                <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="true">
                                    ${avatarContent}
                                </div>
                            </div>
                        `;
                    } else {
                        // 对方的消息：头像在左，气泡在左，显示昵称
                        // 获取发送者的气泡样式
                        let senderBubbleStyle = '';
                        if (msg.senderId) {
                            const senderChat = this.getChat(msg.senderId);
                            if (senderChat && !senderChat.isNPC) {
                                const shape = senderChat.bubbleShape || 'rounded';
                                const bgColor = senderChat.bubbleBgColor || '#e9ecef';
                                const textColor = senderChat.bubbleTextColor || '#212529';
                                const pattern = senderChat.bubblePattern || 'none';
                                senderBubbleStyle = `data-bubble-shape="${shape}" data-bubble-bg="${bgColor}" data-bubble-text="${textColor}" data-bubble-pattern="${pattern}"`;
                            }
                        }
                        html += `
                            <div class="message-row left${selectedClass}" data-msg-idx="${idx}">
                                ${checkboxHtml}
                                <div class="message-avatar" data-chat-id="${chat.id}" data-is-me="false" data-chat-name="${displayName}" data-sender-id="${msg.senderId || ''}">
                                    ${avatarContent}
                                </div>
                                <div class="message-bubble-wrapper">
                                    <div class="message-name">${displayName}</div>
                                    <div class="message-bubble received" ${senderBubbleStyle}>${messageContent}</div>
                                </div>
                            </div>
                        `;
                    }
                }
            }
        });

        chatMessagesEl.innerHTML = html;
        // 应用气泡样式（为 .message-bubble 添加形状样式）
        this.applyBubbleStyle(chat);
        if (chat.isGroup) this.bindMessageContextMenu();
    }

    updateTimeLabels() {
        const separators = document.querySelectorAll('.time-separator');
        if (separators.length) {
            separators.forEach(sep => {
                const timestamp = sep.getAttribute('data-timestamp');
                if (timestamp) {
                    const date = new Date(timestamp);
                    if (!isNaN(date)) sep.textContent = this.getRelativeTime(date);
                }
            });
        }
        this.renderChatList();
    }

    bindChatEvents(chatId) {
        const backBtn = document.getElementById('back-btn');
        const sendBtn = document.getElementById('send-btn');
        const msgInput = document.getElementById('msg-input');
        const emojiBtn = document.getElementById('emoji-btn');
        const addBtn = document.getElementById('add-btn');
        const chatTitle = document.getElementById('chat-title');
        const chatAvatarContainer = document.querySelector('.chat-avatar');

        backBtn.onclick = () => this.closeChat();
        sendBtn.onclick = () => this.sendMessage(chatId);
        msgInput.onkeypress = (e) => { if (e.key === 'Enter') this.sendMessage(chatId); };
        msgInput.oninput = () => { sendBtn.disabled = !msgInput.value.trim(); };
        emojiBtn.onclick = () => this.toggleBottomSheet('emoji');
        addBtn.onclick = () => this.toggleBottomSheet('menu');
        // 群头像点击打开设置
        if (chatAvatarContainer) chatAvatarContainer.onclick = () => this.openSettings();

        // 为群名称添加双击事件监听
        if (chatTitle) {
            // 移除旧监听避免重复
            if (chatTitle._dblclickHandler) {
                chatTitle.removeEventListener('dblclick', chatTitle._dblclickHandler);
            }
            const dblclickHandler = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const chat = this.currentChat;
                if (chat && chat.isGroup) {
                    this.patWholeGroup(chat);
                }
            };
            chatTitle.addEventListener('dblclick', dblclickHandler);
            chatTitle._dblclickHandler = dblclickHandler;

            // 确保没有 onclick 绑定
            chatTitle.onclick = null;
        }

        // 绑定消息区域的长按和右键事件
        this.bindMessageContextMenu();

        // 绑定公告栏收起/展开事件
        const toggleBtn = document.getElementById('toggle-notice-btn');
        if (toggleBtn) {
            toggleBtn.onclick = (e) => {
                e.stopPropagation();
                const bar = document.getElementById('group-notice-bar');
                bar.classList.toggle('collapsed');
                toggleBtn.textContent = bar.classList.contains('collapsed') ? '▼' : '▲';
            };
        }

        // 绑定输入框的 @ 监听（复用已有的 msgInput 变量）
        if (typeof msgInput !== 'undefined' && msgInput) {
            // 移除旧监听器避免重复
            if (msgInput._atHandler) msgInput.removeEventListener('input', msgInput._atHandler);
            const atHandler = (e) => {
                if (!this.currentChat || !this.currentChat.isGroup) return;
                const val = e.target.value;
                const cursorPos = e.target.selectionStart;
                // 检测到刚输入的 @ 符号（前一个字符不是@，且当前字符是@）
                if (val[cursorPos - 1] === '@' && (cursorPos < 2 || val[cursorPos - 2] !== '@')) {
                    this.showAtFloatingMenu(this.currentChat, e.target);
                }
            };
            msgInput.addEventListener('input', atHandler);
            msgInput._atHandler = atHandler;
        }
    }

    /**
     * 显示浮动 @ 菜单（用于群聊）
     */
    showAtFloatingMenu(chat, inputElement) {
        if (!chat || !chat.isGroup) return;
        const members = chat.members || [];
        const validMembers = members.filter(id => id !== 'user_mummy');
        if (validMembers.length === 0) return;

        // 关闭已存在的菜单
        const existing = document.querySelector('.at-floating-menu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.className = 'dynamic-popup-menu at-floating-menu';
        menu.style.maxHeight = '200px';
        menu.style.overflowY = 'auto';

        // 添加成员选项
        validMembers.forEach(memberId => {
            // 关键修改：使用 getMemberDisplayInfo 获取统一的显示名称
            const info = this.getMemberDisplayInfo(memberId);
            const name = info.name;
            const item = document.createElement('div');
            item.className = 'popup-menu-item';
            item.innerHTML = `<span class="popup-menu-text">@${name}</span>`;
            item.onclick = (e) => {
                e.stopPropagation();
                // 替换掉刚刚输入的 @，插入 @名字
                const val = inputElement.value;
                const pos = inputElement.selectionStart;
                const newVal = val.slice(0, pos - 1) + `@${name} ` + val.slice(pos);
                inputElement.value = newVal;
                const newPos = pos - 1 + name.length + 2;
                inputElement.setSelectionRange(newPos, newPos);
                inputElement.focus();
                menu.remove();
            };
            menu.appendChild(item);
        });

        // 添加“@全体成员”选项
        const allItem = document.createElement('div');
        allItem.className = 'popup-menu-item';
        allItem.innerHTML = `<span class="popup-menu-text" style="color: var(--primary);">@全体成员</span>`;
        allItem.onclick = (e) => {
            e.stopPropagation();
            const val = inputElement.value;
            const pos = inputElement.selectionStart;
            const newVal = val.slice(0, pos - 1) + '@全体成员 ' + val.slice(pos);
            inputElement.value = newVal;
            const newPos = pos - 1 + 6;
            inputElement.setSelectionRange(newPos, newPos);
            inputElement.focus();
            menu.remove();
        };
        menu.appendChild(allItem);

        // 定位在输入框上方
        const rect = inputElement.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.left = rect.left + 'px';
        menu.style.bottom = (window.innerHeight - rect.top + 5) + 'px';
        menu.style.minWidth = '150px';
        document.body.appendChild(menu);

        // 点击外部关闭
        const closeHandler = (e) => {
            if (!menu.contains(e.target) && e.target !== inputElement) {
                menu.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 10);
    }

    /**
     * 绑定消息区域的长按和右键事件，用于进入多选模式
     */
    bindMessageContextMenu() {
        const container = document.getElementById('chat-messages');
        if (!container || !this.currentChat) return;

        // 清理之前的事件监听器
        container.querySelectorAll('.message-row').forEach(row => {
            // 移除旧的事件监听器（如果存在）
            if (row._contextHandler) {
                row.removeEventListener('contextmenu', row._contextHandler);
            }
            if (row._touchStartHandler) {
                row.removeEventListener('touchstart', row._touchStartHandler);
            }
            if (row._touchEndHandler) {
                row.removeEventListener('touchend', row._touchEndHandler);
            }
            if (row._touchMoveHandler) {
                row.removeEventListener('touchmove', row._touchMoveHandler);
            }
        });

        // 为所有消息行绑定事件
        container.querySelectorAll('.message-row').forEach((row, idx) => {
            // 桌面端右键进入多选模式
            const contextHandler = (e) => {
                e.preventDefault();
                this.enterMultiSelectMode(idx);
            };
            row.addEventListener('contextmenu', contextHandler);
            row._contextHandler = contextHandler;

            // 移动端长按进入多选模式
            let pressTimer = null;
            let isLongPress = false;

            const touchStartHandler = (e) => {
                if (pressTimer) clearTimeout(pressTimer);
                pressTimer = setTimeout(() => {
                    isLongPress = true;
                    this.enterMultiSelectMode(idx);
                }, 500); // 500ms 长按
            };
            const touchEndHandler = () => {
                if (pressTimer) {
                    clearTimeout(pressTimer);
                    pressTimer = null;
                }
                if (isLongPress) {
                    isLongPress = false;
                }
            };
            const touchMoveHandler = () => {
                if (pressTimer) {
                    clearTimeout(pressTimer);
                    pressTimer = null;
                }
            };

            row.addEventListener('touchstart', touchStartHandler);
            row.addEventListener('touchend', touchEndHandler);
            row.addEventListener('touchmove', touchMoveHandler);

            row._touchStartHandler = touchStartHandler;
            row._touchEndHandler = touchEndHandler;
            row._touchMoveHandler = touchMoveHandler;
        });

        // 点击空白处退出多选模式
        container.addEventListener('click', (e) => {
            if (this.multiSelectMode && e.target === container) {
                this.exitMultiSelectMode();
            }
        });
    }

    toggleBottomSheet(type) {
        const bottomSheet = document.getElementById('bottom-sheet');
        const menuContent = document.querySelector('.menu-content');
        const emojiContent = document.querySelector('.emoji-content');
        const overlay = document.getElementById('overlay');
        const inputArea = document.querySelector('.chat-input-area');
        const isOpen = bottomSheet.classList.contains('active');

        if (!isOpen) {
            bottomSheet.classList.add('active');
            overlay.classList.add('active');
            bottomSheet.offsetHeight;
            if (type === 'menu') {
                // 动态渲染菜单项，根据群聊/单聊显示不同内容
                this.renderMenuSheet();
                menuContent.classList.add('active');
                emojiContent.classList.remove('active');
            } else if (type === 'emoji') {
                emojiContent.classList.add('active');
                menuContent.classList.remove('active');
                // 动态加载表情面板
                this.renderEmojiPanel();
            }
            const sheetHeight = bottomSheet.offsetHeight;
            inputArea.style.marginBottom = `${sheetHeight}px`;
            overlay.onclick = () => this.closeBottomSheet();
        } else {
            const isMenuContent = menuContent.classList.contains('active');
            const isEmojiContent = emojiContent.classList.contains('active');
            if ((type === 'menu' && !isMenuContent) || (type === 'emoji' && !isEmojiContent)) {
                if (type === 'menu') {
                    menuContent.classList.add('active');
                    emojiContent.classList.remove('active');
                    const menuItems = document.querySelectorAll('.menu-item');
                    menuItems.forEach(item => {
                        item.onclick = () => {
                            const action = item.getAttribute('data-action');
                            this.handleMenuAction(action);
                        };
                    });
                } else if (type === 'emoji') {
                    emojiContent.classList.add('active');
                    menuContent.classList.remove('active');
                }
                bottomSheet.offsetHeight;
                const newSheetHeight = bottomSheet.offsetHeight;
                inputArea.style.marginBottom = `${newSheetHeight}px`;
            } else {
                this.closeBottomSheet();
            }
        }
    }

    closeBottomSheet() {
        const bottomSheet = document.getElementById('bottom-sheet');
        const menuContent = document.querySelector('.menu-content');
        const emojiContent = document.querySelector('.emoji-content');
        const overlay = document.getElementById('overlay');
        const inputArea = document.querySelector('.chat-input-area');
        bottomSheet.classList.remove('active');
        menuContent.classList.remove('active');
        emojiContent.classList.remove('active');
        overlay.classList.remove('active');
        inputArea.style.marginBottom = '0';
        overlay.onclick = null;
    }

    renderMenuSheet() {
        const menuContent = document.querySelector('.menu-content');
        if (!menuContent) return;
        const isGroup = this.currentChat && this.currentChat.isGroup;

        let menuHtml = '';
        if (isGroup) {
            // 群聊菜单：保留回复、清空、生成新内容、图片、视频；新增红包和增强心声
            menuHtml = `
                <div class="menu-grid">
                    <div class="menu-item" data-action="reply">
                        <span class="menu-icon">↩️</span>
                        <span class="menu-text">重新回复</span>
                    </div>
                    <div class="menu-item" data-action="clear">
                        <span class="menu-icon">🗑️</span>
                        <span class="menu-text">清空</span>
                    </div>
                    <div class="menu-item" data-action="voice">
                        <span class="menu-icon">🎤</span>
                        <span class="menu-text">心声</span>
                    </div>
                    <div class="menu-item" data-action="redpacket">
                        <span class="menu-icon">🧧</span>
                        <span class="menu-text">红包</span>
                    </div>
                    <div class="menu-item" data-action="rotate">
                        <span class="menu-icon">🔄</span>
                        <span class="menu-text">生成新内容</span>
                    </div>
                    <div class="menu-item" data-action="sendImage">
                        <span class="menu-icon">🖼️</span>
                        <span class="menu-text">发送图片</span>
                    </div>
                    <div class="menu-item" data-action="sendVideo">
                        <span class="menu-icon">🎬</span>
                        <span class="menu-text">发送视频</span>
                    </div>
                </div>
            `;
        } else {
            // 单聊菜单：保持原有全部选项（不变）
            menuHtml = `
                <div class="menu-grid">
                    <div class="menu-item" data-action="reply">
                        <span class="menu-icon">↩️</span>
                        <span class="menu-text">重新回复</span>
                    </div>
                    <div class="menu-item" data-action="clear">
                        <span class="menu-icon">🗑️</span>
                        <span class="menu-text">清空</span>
                    </div>
                    <div class="menu-item" data-action="voice">
                        <span class="menu-icon">🎤</span>
                        <span class="menu-text">心声</span>
                    </div>
                    <div class="menu-item" data-action="transfer">
                        <span class="menu-icon">💸</span>
                        <span class="menu-text">转账</span>
                    </div>
                    <div class="menu-item" data-action="block">
                        <span class="menu-icon">🚫</span>
                        <span class="menu-text">拉黑</span>
                    </div>
                    <div class="menu-item" data-action="diary">
                        <span class="menu-icon">📔</span>
                        <span class="menu-text">心情日记</span>
                    </div>
                    <div class="menu-item" data-action="music">
                        <span class="menu-icon">🎵</span>
                        <span class="menu-text">最近音乐</span>
                    </div>
                    <div class="menu-item" data-action="tasks">
                        <span class="menu-icon">✅</span>
                        <span class="menu-text">任务清单</span>
                    </div>
                    <div class="menu-item" data-action="secret">
                        <span class="menu-icon">🔒</span>
                        <span class="menu-text">秘密日记</span>
                    </div>
                    <div class="menu-item" data-action="rotate">
                        <span class="menu-icon">🔄</span>
                        <span class="menu-text">生成新内容</span>
                    </div>
                    <div class="menu-item" data-action="sendImage">
                        <span class="menu-icon">🖼️</span>
                        <span class="menu-text">发送图片</span>
                    </div>
                    <div class="menu-item" data-action="sendVideo">
                        <span class="menu-icon">🎬</span>
                        <span class="menu-text">发送视频</span>
                    </div>
                </div>
            `;
        }
        menuContent.innerHTML = menuHtml;

        // 重新绑定菜单项点击事件
        const menuItems = menuContent.querySelectorAll('.menu-item');
        menuItems.forEach(item => {
            item.onclick = () => {
                const action = item.getAttribute('data-action');
                this.handleMenuAction(action);
            };
        });
    }

    renderEmojiPanel() {
        const emojiContent = document.querySelector('.emoji-content');
        if (!emojiContent) return;

        // 从mammySettings获取表情分组
        const emotions = this.mammySettings?.emotions || {};
        const emotionCategories = Object.keys(emotions);

        if (emotionCategories.length === 0) {
            emojiContent.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">暂无表情</p>';
            return;
        }

        emojiContent.innerHTML = emotionCategories.map(category => {
            const emotionItems = emotions[category] || [];
            return `
                <div class="category" data-category="${category}">
                    <h3>${this.getEmotionCategoryName(category)}</h3>
                    <div class="emoji-list">
                        ${emotionItems.map(item => this.renderEmotionItem(item)).join('')}
                    </div>
                </div>
            `;
        }).join('');

        // 绑定表情点击事件
        this.bindEmojiEvents();
    }

    getEmotionCategoryName(category) {
        const names = {
            'happy': '开心',
            'sad': '伤心',
            'angry': '愤怒',
            'surprised': '惊讶',
            'excited': '兴奋',
            'touched': '感动',
            'lonely': '孤独',
            'anxious': '焦虑',
            'proud': '自豪',
            'embarrassed': '尴尬',
            'frustrated': '挫败',
            'nostalgic': '怀念',
            'calm': '平静',
            'hopeful': '希望',
            'jealous': '嫉妒',
            'disappointed': '失望',
            'confused': '困惑',
            'bored': '无聊',
            'tired': '疲惫',
            'energetic': '活力',
            'curious': '好奇',
            'grateful': '感激',
            'annoyed': '烦躁',
            'scared': '害怕',
            'worried': '担心',
            'relaxed': '放松',
            'amused': '被逗乐',
            'sympathetic': '同情',
            'shocked': '震惊',
            'envious': '羡慕',
            'betrayed': '背叛感',
            'adored': '被宠爱',
            'rejected': '被拒绝',
            'accepted': '被接纳',
            'free': '自由',
            'trapped': '受困',
            'peaceful': '安宁',
            'restless': '不安'
        };
        return names[category] || category;
    }

    renderEmotionItem(emotion) {
        // 判断是emoji还是图片URL
        if (emotion && (emotion.startsWith('http://') || emotion.startsWith('https://'))) {
            // 图片URL
            return `<span class="emoji-item" data-emotion="${emotion}">
                <img src="${emotion}" alt="表情" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                <span class="emoji-fallback" style="display: none;">😊</span>
            </span>`;
        } else {
            // emoji字符
            return `<span class="emoji-item" data-emotion="${emotion || '😊'}">${emotion || '😊'}</span>`;
        }
    }

    bindEmojiEvents() {
        // 使用事件委托，绑定到 emoji-content 容器
        const emojiContent = document.querySelector('.emoji-content');
        if (!emojiContent) return;

        emojiContent.onclick = (event) => {
            // 使用 closest 获取最外层的 .emoji-item 元素
            const emojiItem = event.target.closest('.emoji-item');
            if (!emojiItem) return;

            const emotion = emojiItem.getAttribute('data-emotion');
            const input = document.getElementById('msg-input');
            if (input && emotion && emotion !== 'undefined' && emotion !== 'null') {
                // 如果是图片URL，插入为图片格式
                if (emotion.startsWith('http://') || emotion.startsWith('https://')) {
                    input.value += `![图片](${emotion})`;
                } else {
                    input.value += emotion;
                }
                this.closeBottomSheet();
                // 触发input事件以更新发送按钮状态
                const event = new Event('input', { bubbles: true });
                input.dispatchEvent(event);
            }
        };
    }

    detectEmotionFromText(text) {
        const emotionKeywords = {
            'happy': ['开心', '高兴', '快乐', '喜悦', '愉快', '兴奋', '谢谢', '感谢', '感恩', '满意', '喜欢', '爱', '没问题', '好的', '明白', '了解', '认可', '赞同', '哈哈', '嘿嘿', '耶', '棒', '好'],
            'sad': ['伤心', '难过', '悲伤', '痛苦', '哭泣', '失望', '沮丧', '郁闷', '失落', '孤独', '寂寞', '可怜', '悲剧', '找不到', '不要我', '抛弃', '离开', '失去', '想念', '想哭', '难受', '烦', '烦死了'],
            'angry': ['生气', '愤怒', '恼火', '发火', '不爽', '讨厌', '恨', '恼怒', '愤慨', '厌恶', '鄙视', '气死', '烦'],
            'surprised': ['惊讶', '惊奇', '意外', '震惊', '吓一跳', '出乎意料', '奇怪', '纳闷', '疑惑', '居然', '竟然', '天哪', '哇']
        };

        const scores = { happy: 0, sad: 0, angry: 0, surprised: 0 };
        const lowerText = text.toLowerCase();
        for (const [emotion, keywords] of Object.entries(emotionKeywords)) {
            for (const keyword of keywords) {
                if (lowerText.includes(keyword)) {
                    scores[emotion] += 1;
                }
            }
        }
        let maxScore = 0;
        let detectedEmotion = null;
        for (const [emotion, score] of Object.entries(scores)) {
            if (score > maxScore) {
                maxScore = score;
                detectedEmotion = emotion;
            }
        }
        return detectedEmotion;
    }

    sendEmotionIfNeeded(chat, userMessage) {
        // 检查表情频率 - 概率判断：emojiFreq 0-1，0.5 = 50%概率
        if (chat.emojiFreq === undefined || chat.emojiFreq === null || Math.random() > chat.emojiFreq) {
            console.log('表情频率未命中，不发送表情'); // 调试日志
            return; // 不发送表情
        }
        console.log('表情频率命中，准备检测情绪'); // 调试日志

        // 检测用户情绪
        const emotion = this.detectEmotionFromText(userMessage);
        let emotionList = [];
        if (emotion) {
            console.log('检测到情绪:', emotion); // 调试日志
            // 从对应情绪分类中获取表情
            emotionList = this.mammySettings?.emotions?.[emotion] || [];
        }

        // 如果未检测到情绪或该情绪分类中没有表情，使用 happy 分类作为回退
        if (emotionList.length === 0) {
            console.log(`情绪分类 "${emotion}" 中没有可用的表情，使用 happy 分类作为回退`); // 调试日志
            emotionList = this.mammySettings?.emotions?.['happy'] || [];
        }

        // 如果还是没有表情，则不发送
        if (emotionList.length === 0) {
            console.log('没有可用的表情，不发送'); // 调试日志
            return;
        }

        // 随机选择一个表情
        const selectedEmotion = emotionList[Math.floor(Math.random() * emotionList.length)];
        console.log('选择发送表情:', selectedEmotion); // 调试日志

        // 发送表情消息
        setTimeout(() => {
            console.log('正在发送表情消息...'); // 调试日志
            this.addMessage(chat.id, selectedEmotion, false);
            this.renderChatList();
            if (this.currentChat && this.currentChat.id === chat.id) {
                this.renderMessages(this.currentChat);
                this.applyBubbleStyle(this.currentChat);
                this.scrollToBottom();
            }
            console.log('表情消息已发送'); // 调试日志
        }, 500);
    }

    /**
     * 根据情绪标签发送表情（从妈咪中心对应分组随机选一个）
     */
    sendEmotionByTag(chat, emotionTag) {
        // 情绪标签映射：将 AI 可能输出的、但不在表情库中的情绪映射到已有的分组
        const emotionMapping = {
            'touched': 'happy',   // 感动 → 开心
            'excited': 'happy',
            'nostalgic': 'sad',
            'lonely': 'sad',
            'anxious': 'sad',
            'proud': 'happy',
            'embarrassed': 'sad',
            'frustrated': 'angry',
            'calm': 'happy',
            'hopeful': 'happy',
            'jealous': 'sad',
            'disappointed': 'sad',
            'confused': 'surprised',
            'bored': 'sad',
            'tired': 'sad',
            'energetic': 'happy',
            'curious': 'happy',
            'grateful': 'happy',
            'annoyed': 'angry',
            'scared': 'sad',
            'worried': 'sad',
            'relaxed': 'happy',
            'amused': 'happy',
            'sympathetic': 'sad',
            'shocked': 'surprised',
            'envious': 'sad',
            'betrayed': 'angry',
            'adored': 'happy',
            'rejected': 'sad',
            'accepted': 'happy',
            'free': 'happy',
            'trapped': 'sad',
            'peaceful': 'happy',
            'restless': 'sad'
        };
        if (emotionMapping[emotionTag]) {
            emotionTag = emotionMapping[emotionTag];
            console.log(`情绪标签映射: ${arguments[1]} -> ${emotionTag}`);
        }

        // 中文情绪标签映射到英文
        const chineseToEnglish = {
            '委屈': 'sad',
            '警惕': 'surprised',
            '开心': 'happy',
            '高兴': 'happy',
            '快乐': 'happy',
            '伤心': 'sad',
            '难过': 'sad',
            '悲伤': 'sad',
            '生气': 'angry',
            '愤怒': 'angry',
            '惊讶': 'surprised',
            '惊奇': 'surprised',
            '兴奋': 'excited',
            '感动': 'touched',
            '孤独': 'lonely',
            '寂寞': 'lonely',
            '焦虑': 'anxious',
            '紧张': 'anxious',
            '自豪': 'proud',
            '骄傲': 'proud',
            '尴尬': 'embarrassed',
            '挫败': 'frustrated',
            '怀念': 'nostalgic',
            '平静': 'calm',
            '冷静': 'calm',
            '希望': 'hopeful',
            '嫉妒': 'jealous',
            '失望': 'disappointed',
            '困惑': 'confused',
            '无聊': 'bored',
            '疲惫': 'tired',
            '活力': 'energetic',
            '好奇': 'curious',
            '感激': 'grateful',
            '感谢': 'grateful',
            '烦躁': 'annoyed',
            '害怕': 'scared',
            '恐惧': 'scared',
            '担心': 'worried',
            '放松': 'relaxed',
            '被逗乐': 'amused',
            '同情': 'sympathetic',
            '震惊': 'shocked',
            '羡慕': 'envious',
            '背叛': 'betrayed',
            '被宠爱': 'adored',
            '被拒绝': 'rejected',
            '被接纳': 'accepted',
            '自由': 'free',
            '受困': 'trapped',
            '安宁': 'peaceful',
            '不安': 'restless'
        };

        // 如果传入的 emotionTag 是中文，尝试映射为英文
        if (chineseToEnglish[emotionTag]) {
            console.log(`中文情绪标签映射: ${emotionTag} -> ${chineseToEnglish[emotionTag]}`);
            emotionTag = chineseToEnglish[emotionTag];
        }

        // 检查表情频率
        if (chat.emojiFreq === undefined || chat.emojiFreq === null || Math.random() > chat.emojiFreq) {
            console.log('表情频率未命中，不发送表情');
            return;
        }

        // 从对应分组获取表情列表
        let emotionList = this.mammySettings?.emotions?.[emotionTag] || [];
        if (emotionList.length === 0) {
            console.log(`情绪分组 "${emotionTag}" 中没有表情，使用 happy 作为回退`);
            emotionList = this.mammySettings?.emotions?.['happy'] || [];
        }
        if (emotionList.length === 0) {
            console.log('没有任何表情，不发送');
            return;
        }

        const selectedEmotion = emotionList[Math.floor(Math.random() * emotionList.length)];
        console.log(`根据情绪标签 ${emotionTag} 发送表情:`, selectedEmotion);

        // 发送表情消息（延迟 200ms 避免与最后一条文本重叠）
        setTimeout(() => {
            this.addMessage(chat.id, selectedEmotion, false);
            this.renderChatList();
            if (this.currentChat && this.currentChat.id === chat.id) {
                this.renderMessages(this.currentChat);
                this.applyBubbleStyle(this.currentChat);
                this.scrollToBottom();
            }
        }, 200);
    }

    handleMenuAction(action) {
        const actions = {
            reply: '重新回复（回溯）',
            clear: '清空',
            voice: '心声',
            transfer: '转账',
            block: '拉黑',
            diary: '心情日记',
            music: '最近音乐',
            tasks: '任务清单',
            secret: '秘密日记',
            rotate: '生成新内容',
            settings: '回复设置',
            sendImage: '发送图片',
            sendVideo: '发送视频'
        };

        console.log('Menu action:', action);

        switch (action) {
            case 'clear':
                this.handleClearMessages();
                break;
            case 'rotate':
                this.handleGenerateNewContent();
                break;
            case 'transfer':
                this.handleTransferMoney();
                break;
            case 'block':
                this.handleBlockUser();
                break;
            case 'voice':
                if (this.currentChat && this.currentChat.isGroup) {
                    console.log('✅ 群聊心声分支被正确触发！');
                    this.handleGroupVoice();
                } else {
                    console.log('✅ 单聊心声分支被正确触发！');
                    this.handleVoiceThoughts();
                }
                break;
            case 'redpacket':
                this.handleRedPacket();
                break;
            case 'reply':
                this.handleReplyBack();
                break;
            case 'sendImage':
                this.handleSendImage();
                break;
            case 'sendVideo':
                this.handleSendVideo();
                break;
            case 'tasks':
                this.openTaskList();
                break;
            case 'diary':
                this.openMoodDiary();
                break;
            case 'music':
                this.openMusicPanel();
                break;
            case 'secret':
                this.openSecretDiary();
                break;
            default:
                // 其他功能保持原样
                this.showNotification(`${actions[action] || '未知功能'} - 功能开发中`);
        }

        this.closeAllPanels();
    }

    /**
     * 发送图片卡片
     */
    handleSendImage() {
        this.createMediaCardModal('image');
    }

    /**
     * 发送视频卡片
     */
    handleSendVideo() {
        this.createMediaCardModal('video');
    }

    /**
     * 创建媒体卡片模态框
     */
    createMediaCardModal(type) {
        const modal = document.createElement('div');
        modal.id = `${type}-card-modal`;
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>发送${type === 'image' ? '图片' : '视频'}</h3>
                    <button class="close-btn" onclick="this.closest('.modal').classList.remove('active')">✕</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label for="${type}-description">描述文字</label>
                        <input type="text" id="${type}-description" class="form-control" placeholder="例如：一只猫在打滚">
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="cancel-btn" onclick="this.closest('.modal').classList.remove('active')">取消</button>
                    <button class="submit-btn" id="send-${type}-card-btn">发送</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // 绑定发送按钮事件
        const sendBtn = document.getElementById(`send-${type}-card-btn`);
        sendBtn.onclick = () => {
            const description = document.getElementById(`${type}-description`).value;
            if (description) {
                this.sendMediaCard(type, description);
                modal.remove();
            } else {
                this.showNotification('请输入描述文字');
            }
        };

        // 显示模态框
        modal.classList.add('active');
    }

    /**
     * 发送媒体卡片
     */
    async sendMediaCard(type, description) {
        if (!this.currentChat) return;

        const message = {
            id: Date.now() + Math.random(),
            text: description,
            time: this.getRelativeTime(new Date()),
            isMe: true,
            type: type === 'image' ? 'image_card' : 'video_card',
            cardDescription: description,
            timestamp: new Date().toISOString()
        };

        this.currentChat.messages.push(message);
        this.saveChats();
        this.renderMessages(this.currentChat);
        this.scrollToBottom();

        console.log(`已发送${type}卡片: ${description}`);

        // 调用 AI 回复
        try {
            const cardTypeText = type === 'image' ? '图片' : '视频';
            const aiReply = await this.callAI(this.currentChat.id, `妈咪分享了一张${cardTypeText}卡片，描述："${description}"，请根据角色性格回复一条消息（如好奇、赞美、调侃等），不要超过50字。`);
            if (aiReply) {
                this.addMessageWithEmotion(this.currentChat.id, aiReply);
            }
        } catch (error) {
            console.error('AI回复失败:', error);
        }
    }

    /**
     * 主动发送媒体卡片（AI控制）
     */
    async sendAIMediaCard(chatId, type, force = false, senderId = null) {
        console.log(`[媒体卡片] 尝试发送，类型：${type}，强制：${force}，发送者ID：${senderId || '无'}`);

        const chat = this.getChat(chatId);
        if (!chat) return;

        // 获取频率设置，如果是强制发送则忽略频率检查
        if (!force) {
            let freq = 0;
            // 优先使用 senderId 对应成员（NPC）的频率
            if (senderId) {
                if (senderId.startsWith('npc_')) {
                    // NPC 场景
                    const npcSettings = chat.npcSettings?.[senderId] || {};
                    freq = type === 'image' ? npcSettings.imageFrequency ?? 0 : npcSettings.videoFrequency ?? 0;
                } else if (chat.members && chat.members.includes(senderId)) {
                    // 群聊成员
                    const member = this.getChat(senderId);
                    if (member) {
                        freq = type === 'image' ? member.imageFrequency || 0 : member.videoFrequency || 0;
                    }
                }
            }
            // 如果找不到 senderId 或不是群聊，回退到使用群聊的频率
            if (freq === 0 && chat.isGroup) {
                freq = type === 'image' ? chat.imageFrequency || 0 : chat.videoFrequency || 0;
            } else if (freq === 0) {
                freq = type === 'image' ? this.mammySettings.imageFrequency || 0 : this.mammySettings.videoFrequency || 0;
            }

            if (Math.random() > freq) return;
        }

        try {
            // 获取最近几条对话作为上下文
            const recentMessages = chat.messages.slice(-6).map(msg => ({
                role: msg.isMe ? 'user' : 'assistant',
                content: msg.text || msg.content || ''
            }));

            // 构建系统提示
            let systemPrompt = `你是${chat.name}，`;
            if (chat.personalityPrompt) systemPrompt += `你的性格：${chat.personalityPrompt}。`;
            if (chat.worldId) {
                const world = this.worldBooks.find(w => w.id === chat.worldId);
                if (world && world.description) systemPrompt += `世界观设定：${world.description}。`;
            }
            systemPrompt += `请根据你们最近的对话内容，生成一个${type === 'image' ? '图片' : '视频'}的描述（一句话，不超过15个字），描述要贴合对话情境，自然有趣。不要输出其他任何文字。`;

            const userPrompt = `最近对话：\n${recentMessages.map(m => `${m.role === 'user' ? '妈咪' : chat.name}：${m.content}`).join('\n')}\n\n请根据对话生成一个${type === 'image' ? '图片' : '视频'}描述。`;

            const response = await fetch(this.mammySettings.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.mammySettings.apiKey}`
                },
                body: JSON.stringify({
                    model: this.mammySettings.modelName,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                temperature: 0.7,
                            })
        });

            const data = await response.json();
            let description = data.choices[0].message.content.replace(/[\[\]]/g, '').trim();
            // 限制长度
            if (description.length > 30) description = description.substring(0, 30);

            // 构造卡片消息
            const cardMessage = {
                id: Date.now() + Math.random(),
                text: description,
                time: this.getRelativeTime(new Date()),
                isMe: !senderId, // 如果 senderId 存在，则不是"我"发送的
                senderId: senderId || null, // 设置发送者ID
                type: type === 'image' ? 'image_card' : 'video_card',
                cardDescription: description,
                timestamp: new Date().toISOString()
            };

            chat.messages.push(cardMessage);
            console.log(`[媒体卡片] 已发送，发送者：${senderId ? this.getMemberDisplayInfo(senderId).name : '妈咪'}`);

            chat.lastMessage = `[${type === 'image' ? '图片' : '视频'}] ${description}`;
            chat.lastTimestamp = cardMessage.timestamp;
            chat.lastTime = this.getRelativeTime(new Date());

            // 如果当前正在查看该聊天，实时渲染
            if (this.currentChat && this.currentChat.id === chatId) {
                this.renderMessages(chat);
                this.scrollToBottom();
            } else {
                // 不在当前聊天窗口，增加未读计数
                chat.unreadCount = (chat.unreadCount || 0) + 1;
            }

            this.saveChats();
            this.renderChatList();
            this.updateMessageBadge();

            console.log(`AI主动发送${type}卡片: ${description}`);

        } catch (error) {
            console.error(`AI生成${type}描述失败:`, error);
            // 降级：使用简单描述
            const defaultDesc = type === 'image' ? '一张有趣的图片' : '一段有趣的视频';
            const cardMessage = {
                id: Date.now() + Math.random(),
                text: defaultDesc,
                time: this.getRelativeTime(new Date()),
                isMe: false,
                type: type === 'image' ? 'image_card' : 'video_card',
                cardDescription: defaultDesc,
                timestamp: new Date().toISOString()
            };
            chat.messages.push(cardMessage);
            chat.lastMessage = `[${type === 'image' ? '图片' : '视频'}] ${defaultDesc}`;
            chat.lastTimestamp = cardMessage.timestamp;
            chat.lastTime = this.getRelativeTime(new Date());
            if (this.currentChat && this.currentChat.id === chatId) {
                this.renderMessages(chat);
                this.scrollToBottom();
            } else {
                chat.unreadCount = (chat.unreadCount || 0) + 1;
            }
            this.saveChats();
            this.renderChatList();
            this.updateMessageBadge();
        }
    }

    /**
     * 任务清单功能
     */
    handleTaskList() {
        if (!this.currentChat) return;

        const modal = document.getElementById('task-list-modal');
        if (!modal) {
            this.createTaskListModal();
        } else {
            modal.classList.add('active');
            this.renderTaskList();
        }
    }

    /**
     * 创建任务清单模态框
     */
    createTaskListModal() {
        const modal = document.createElement('div');
        modal.id = 'task-list-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>📋 ${this.currentChat.name} 的任务清单</h3>
                    <button class="close-btn" onclick="this.closest('.modal').classList.remove('active')">✕</button>
                </div>
                <div class="modal-body">
                    <div style="margin-bottom: 12px;">
                        <button class="submit-btn" id="add-task-btn" style="margin-right: 8px;">➕ 添加任务</button>
                        <button class="submit-btn" id="ai-generate-tasks-btn">🤖 AI生成任务</button>
                    </div>
                    <div id="task-list-container" style="max-height: 300px; overflow-y: auto;">
                        <!-- 任务列表将动态生成 -->
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="cancel-btn" onclick="this.closest('.modal').classList.remove('active')">关闭</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // 绑定按钮事件
        const addBtn = document.getElementById('add-task-btn');
        const aiBtn = document.getElementById('ai-generate-tasks-btn');

        addBtn.onclick = () => {
            this.addNewTask();
        };

        aiBtn.onclick = () => {
            this.generateAITasks();
        };

        // 渲染任务列表
        this.renderTaskList();
    }

    /**
     * 渲染任务列表
     */
    renderTaskList() {
        if (!this.currentChat) return;

        const container = document.getElementById('task-list-container');
        if (!container) return;

        // 初始化任务列表
        if (!this.currentChat.tasks) this.currentChat.tasks = [];

        container.innerHTML = '';

        this.currentChat.tasks.forEach((task, index) => {
            const taskItem = document.createElement('div');
            taskItem.style.cssText = `
                padding: 8px 12px;
                border: 1px solid #ddd;
                border-radius: 8px;
                margin-bottom: 8px;
                display: flex;
                align-items: center;
                gap: 8px;
            `;

            taskItem.innerHTML = `
                <input type="checkbox" ${task.completed ? 'checked' : ''} onchange="chatManager.toggleTask(${index})">
                <span style="${task.completed ? 'text-decoration: line-through; color: #999;' : ''} flex: 1;">${task.text}</span>
                <button class="cancel-btn" style="padding: 4px 8px; font-size: 12px;" onclick="chatManager.deleteTask(${index})">删除</button>
            `;

            container.appendChild(taskItem);
        });
    }

    /**
     * 添加新任务
     */
    addNewTask(text = '') {
        if (!this.currentChat) return;

        const taskText = prompt('请输入任务内容:', text);
        if (taskText) {
            if (!this.currentChat.tasks) this.currentChat.tasks = [];

            this.currentChat.tasks.push({
                text: taskText,
                completed: false,
                createdAt: new Date().toISOString()
            });

            this.saveChats();
            this.renderTaskList();
        }
    }

    /**
     * 删除任务
     */
    deleteTask(index) {
        if (!this.currentChat || !this.currentChat.tasks) return;

        this.currentChat.tasks.splice(index, 1);
        this.saveChats();
        this.renderTaskList();
    }

    /**
     * 切换任务完成状态
     */
    toggleTask(index) {
        if (!this.currentChat || !this.currentChat.tasks) return;

        const task = this.currentChat.tasks[index];
        if (task) {
            task.completed = !task.completed;
            this.saveChats();
            this.renderTaskList();
        }
    }

    /**
     * AI生成任务
     */
    async generateAITasks() {
        if (!this.currentChat) return;

        const modal = document.getElementById('task-list-modal');
        if (!modal) return;

        // 显示等待状态
        modal.querySelector('.modal-body').innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; min-height: 200px;">
                <div class="spinner" style="width: 30px; height: 30px;"></div>
            </div>
        `;

        try {
            const systemPrompt = `作为${this.currentChat.name}，请根据你的角色性格和当前对话，生成3-5条合理的日常任务。
            任务应该符合角色身份，简短有趣，每条不超过15个字。格式：任务1\n任务2\n任务3`;

            const context = this.currentChat.messages.slice(-5).map(msg => ({
                role: msg.isMe ? 'user' : 'assistant',
                content: msg.text || msg.content || ''
            }));

            const messages = [
                { role: 'system', content: systemPrompt },
                ...context,
                { role: 'user', content: '请生成我的日常任务清单' }
            ];

            const response = await fetch(this.mammySettings.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.mammySettings.apiKey}`
                },
                body: JSON.stringify({
                    model: this.mammySettings.modelName,
                    messages: messages,
                    temperature: 0.7,
                                    })
            });

            const data = await response.json();
            const tasksText = data.choices[0].message.content;
            const tasks = tasksText.split('\n').filter(task => task.trim());

            // 添加到任务列表
            if (!this.currentChat.tasks) this.currentChat.tasks = [];

            tasks.forEach(task => {
                if (task.length > 0) {
                    this.currentChat.tasks.push({
                        text: task,
                        completed: false,
                        createdAt: new Date().toISOString(),
                        isAIGenerated: true
                    });
                }
            });

            this.saveChats();
            this.renderTaskList();

        } catch (error) {
            console.error('AI生成任务失败:', error);
            this.showNotification('生成任务失败，请重试');
        }
    }

    /**
     * 秘密日记功能
     */
    handleSecretDiary() {
        if (!this.currentChat) return;

        const modal = document.getElementById('secret-diary-modal');
        if (!modal) {
            this.createSecretDiaryModal();
        } else {
            modal.classList.add('active');
            this.renderSecretDiary();
        }
    }

    /**
     * 创建秘密日记模态框
     */
    createSecretDiaryModal() {
        const modal = document.createElement('div');
        modal.id = 'secret-diary-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>🔒 ${this.currentChat.name} 的秘密日记</h3>
                    <button class="close-btn" onclick="this.closest('.modal').classList.remove('active')">✕</button>
                </div>
                <div class="modal-body">
                    <div style="margin-bottom: 12px;">
                        <button class="submit-btn" id="add-secret-diary-btn" style="margin-right: 8px;">➕ 添加日记</button>
                    </div>
                    <div id="secret-diary-list" style="max-height: 300px; overflow-y: auto;">
                        <!-- 日记列表将动态生成 -->
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="cancel-btn" onclick="this.closest('.modal').classList.remove('active')">关闭</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // 绑定按钮事件
        const addBtn = document.getElementById('add-secret-diary-btn');
        addBtn.onclick = () => {
            this.addSecretDiaryEntry();
        };

        // 渲染日记列表
        this.renderSecretDiary();
    }

    /**
     * 渲染秘密日记列表
     */
    renderSecretDiary() {
        if (!this.currentChat) return;

        const container = document.getElementById('secret-diary-list');
        if (!container) return;

        // 初始化秘密日记列表
        if (!this.secretDiaries) this.secretDiaries = {};
        if (!this.secretDiaries[this.currentChat.id]) this.secretDiaries[this.currentChat.id] = [];

        const entries = this.secretDiaries[this.currentChat.id];
        container.innerHTML = '';

        entries.forEach((entry, index) => {
            const entryItem = document.createElement('div');
            entryItem.style.cssText = `
                padding: 12px;
                border: 1px solid #333;
                border-radius: 8px;
                margin-bottom: 8px;
                background: #1a1a1a;
                color: #ccc;
            `;

            const date = new Date(entry.timestamp).toLocaleString();
            entryItem.innerHTML = `
                <div style="font-size: 12px; color: #999; margin-bottom: 4px;">${date}</div>
                <div style="font-size: 14px; line-height: 1.5;">${entry.content}</div>
                <div style="margin-top: 8px; text-align: right;">
                    <button class="cancel-btn" style="padding: 4px 8px; font-size: 12px;" onclick="chatManager.editSecretDiary(${index})">编辑</button>
                    <button class="cancel-btn" style="padding: 4px 8px; font-size: 12px;" onclick="chatManager.deleteSecretDiary(${index})">删除</button>
                </div>
            `;

            container.appendChild(entryItem);
        });
    }

    /**
     * 添加秘密日记条目
     */
    addSecretDiaryEntry(content = '') {
        if (!this.currentChat) return;

        const entryContent = prompt('请输入秘密日记内容:', content);
        if (entryContent) {
            if (!this.secretDiaries) this.secretDiaries = {};
            if (!this.secretDiaries[this.currentChat.id]) this.secretDiaries[this.currentChat.id] = [];

            this.secretDiaries[this.currentChat.id].push({
                content: entryContent,
                timestamp: new Date().toISOString(),
                createdAt: new Date().toISOString()
            });

            this.saveChats();
            this.renderSecretDiary();
        }
    }

    /**
     * 编辑秘密日记条目
     */
    editSecretDiary(index) {
        if (!this.currentChat || !this.secretDiaries?.[this.currentChat.id]) return;

        const entry = this.secretDiaries[this.currentChat.id][index];
        if (!entry) return;

        this.addSecretDiaryEntry(entry.content);
        if (this.secretDiaries[this.currentChat.id][index]) {
            this.secretDiaries[this.currentChat.id][index].content = entry.content;
            this.saveChats();
            this.renderSecretDiary();
        }
    }

    /**
     * 删除秘密日记条目
     */
    deleteSecretDiary(index) {
        if (!this.currentChat || !this.secretDiaries?.[this.currentChat.id]) return;

        if (confirm('确定要删除这条秘密日记吗？')) {
            this.secretDiaries[this.currentChat.id].splice(index, 1);
            this.saveChats();
            this.renderSecretDiary();
        }
    }

    /**
     * 显示转发消息选择器（长按消息时调用）
     * @param {string} chatId 当前聊天ID（群聊）
     * @param {Object} message 要转发的消息对象
     */
    showForwardSelector(chatId, message) {
        // 获取所有聊天（排除自己和妈咪）
        const targetChats = this.chats.filter(chat => chat.id !== 'user_mummy' && chat.id !== chatId);
        if (targetChats.length === 0) {
            this.showNotification('没有可转发的聊天');
            return;
        }

        // 创建转发选择模态框
        const modal = document.createElement('div');
        modal.id = 'forward-select-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>选择转发对象</h3>
                    <button class="close-btn" onclick="this.closest('.modal').classList.remove('active')">✕</button>
                </div>
                <div class="modal-body" style="max-height: 300px; overflow-y: auto;">
                    <div class="member-selection-list" id="forward-target-list">
                        <!-- 目标列表将动态生成 -->
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="cancel-btn" id="forward-cancel-btn">取消</button>
                    <button class="submit-btn" id="forward-confirm-btn" disabled>确认转发</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // 渲染目标列表
        const container = document.getElementById('forward-target-list');
        container.innerHTML = targetChats.map((chat, index) => `
            <div class="member-item" style="margin-bottom: 8px;">
                <input type="radio" name="forward-target" value="${chat.id}" id="forward-${chat.id}">
                <label for="forward-${chat.id}" style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                    <div class="member-avatar">
                        <span>${chat.avatar || '👤'}</span>
                    </div>
                    <span>${chat.name}</span>
                </label>
            </div>
        `).join('');

        // 绑定选择事件
        container.querySelectorAll('input[type="radio"]').forEach(radio => {
            radio.addEventListener('change', () => {
                document.getElementById('forward-confirm-btn').disabled = false;
            });
        });

        // 绑定按钮事件
        document.getElementById('forward-cancel-btn').onclick = () => {
            modal.remove();
        };

        document.getElementById('forward-confirm-btn').onclick = () => {
            const selected = container.querySelector('input[name="forward-target"]:checked');
            if (selected) {
                this.forwardMessageToChat(message, selected.value);
                modal.remove();
            }
        };

        // 显示模态框
        modal.classList.add('active');
    }

    /**
     * 执行转发：构造卡片消息并发送到目标聊天
     * @param {Object} originalMsg 原始消息对象
     * @param {string} targetChatId 目标单聊ID
     */
    forwardMessageToChat(originalMsg, targetChatId) {
        const targetChat = this.getChat(targetChatId);
        if (!targetChat) return;

        // 获取原始消息发送者信息
        let senderName = '未知';
        if (originalMsg.isMe) {
            senderName = this.mammySettings.nickname || '妈咪';
        } else {
            // 从当前聊天中获取发送者名称（当前聊天是群聊）
            // 注意：群聊消息中需要存储 senderName，如果没有则用角色名
            senderName = originalMsg.senderName || (originalMsg.isMe ? '妈咪' : '群成员');
        }

        // 构造卡片内容
        let cardTitle = '';
        let cardPreview = '';
        let cardType = 'text';
        let originalContent = '';

        if (originalMsg.type === 'post_card') {
            cardType = 'post';
            cardTitle = originalMsg.title || '帖子分享';
            cardPreview = originalMsg.preview || '';
            originalContent = originalMsg.text || '';
        } else if (originalMsg.type === 'image_card' || originalMsg.isImageCard) {
            cardType = 'image';
            cardTitle = '图片分享';
            cardPreview = originalMsg.cardDescription || '[图片]';
            originalContent = originalMsg.text || '[图片]';
        } else if (originalMsg.type === 'video_card' || originalMsg.isVideoCard) {
            cardType = 'video';
            cardTitle = '视频分享';
            cardPreview = originalMsg.cardDescription || '[视频]';
            originalContent = originalMsg.text || '[视频]';
        } else if (originalMsg.type === 'transfer') {
            cardType = 'transfer';
            cardTitle = '转账';
            cardPreview = `💰 转账 ¥${originalMsg.transferAmount || 'XX.XX'}`;
            originalContent = `转账 ¥${originalMsg.transferAmount || ''}`;
        } else {
            // 普通文本消息
            cardType = 'text';
            cardTitle = '消息转发';
            cardPreview = originalMsg.text || originalMsg.content || '';
            originalContent = originalMsg.text || originalMsg.content || '';
        }

        const myName = this.mammySettings.nickname || '我';
        const originalChatName = this.getDisplayName(this.currentChat);
        const plainText = this.getMessagePlainText(originalMsg);
        const forwardCard = {
            type: 'forward_card',
            originalSender: senderName,
            originalContent: originalContent,
            cardTitle: `${myName} 和 ${originalChatName} 的聊天记录`,
            cardPreview: cardPreview.length > 100 ? cardPreview.substring(0, 100) + '...' : cardPreview,
            cardType: cardType,
            messageCount: 1,
            fullContent: `${senderName}：${plainText}`,
            timestamp: new Date().toISOString(),
            isMe: true,  // 妈咪转发的
            text: `转发了${cardType === 'text' ? '消息' : cardType}：${cardPreview.substring(0, 50)}${cardPreview.length > 50 ? '...' : ''}` // 用于聊天列表显示
        };

        // 添加到目标聊天
        targetChat.messages.push(forwardCard);
        targetChat.lastMessage = forwardCard.text;
        targetChat.lastTimestamp = forwardCard.timestamp;
        targetChat.lastTime = this.getRelativeTime(new Date());
        if (!(this.currentChat && this.currentChat.id === targetChatId)) {
            targetChat.unreadCount = (targetChat.unreadCount || 0) + 1;
        }
        this.saveChats();
        this.renderChatList();
        this.updateMessageBadge();

        // 如果当前正在查看目标聊天，重新渲染
        if (this.currentChat && this.currentChat.id === targetChatId) {
            this.renderMessages(targetChat);
            this.applyBubbleStyle(targetChat);
            this.scrollToBottom();
        }

        console.log(`已转发消息到 ${targetChat.name}`);
    }

    /**
     * 绑定消息右键菜单和长按菜单
     */
    bindMessageContextMenu() {
        const container = document.getElementById('chat-messages');
        if (!container || !this.currentChat) return;

        // 清除之前的事件监听
        container.querySelectorAll('.message-row').forEach(row => {
            row.replaceWith(row.cloneNode(true));
        });

        // 重新绑定事件
        container.querySelectorAll('.message-row').forEach((row, idx) => {
            // 右键菜单（桌面端）
            row.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                // 使用当前消息行的 data-msg-idx 属性获取正确的索引
                const msgIdx = parseInt(row.getAttribute('data-msg-idx'));
                const message = this.currentChat.messages[msgIdx];
                if (!message) return;
                // 如果已在多选模式，切换选中状态；否则显示消息操作菜单
                if (this.multiSelectMode) {
                    this.toggleMessageSelection(message);
                    this.renderMessages(this.currentChat);
                } else {
                    this.showMessageActionMenu(message, e);
                }
            });

            // 移动端长按菜单
            let timer;
            row.addEventListener('touchstart', (e) => {
                timer = setTimeout(() => {
                    // 使用当前消息行的 data-msg-idx 属性获取正确的索引
                    const msgIdx = parseInt(row.getAttribute('data-msg-idx'));
                    const message = this.currentChat.messages[msgIdx];
                    if (message) {
                        // 如果已在多选模式，切换选中状态；否则显示消息操作菜单
                        if (this.multiSelectMode) {
                            this.toggleMessageSelection(message);
                            this.renderMessages(this.currentChat);
                        } else {
                            // 创建触摸事件对象
                            const touchEvent = {
                                ...e,
                                clientX: e.touches[0].clientX,
                                clientY: e.touches[0].clientY,
                                pageX: e.touches[0].pageX,
                                pageY: e.touches[0].pageY,
                                touches: e.touches
                            };
                            this.showMessageActionMenu(message, touchEvent);
                        }
                    }
                }, 500);
            });
            row.addEventListener('touchend', () => clearTimeout(timer));
            row.addEventListener('touchmove', () => clearTimeout(timer));

            // 点击消息选中/取消（多选模式下）
            row.addEventListener('click', (e) => {
                if (this.multiSelectMode && !e.target.closest('input[type="checkbox"]')) {
                    const message = this.currentChat.messages[idx];
                    if (message) {
                        this.toggleMessageSelection(message);
                        this.renderMessages(this.currentChat);
                    }
                }
            });
        });

        // 绑定复选框事件（事件委托）
        container.addEventListener('change', (e) => {
            if (e.target.type === 'checkbox' && e.target.dataset.msgIdx) {
                const idx = parseInt(e.target.dataset.msgIdx);
                const message = this.currentChat.messages[idx];
                if (message) {
                    if (e.target.checked) {
                        this.selectedMessages.add(message);
                    } else {
                        this.selectedMessages.delete(message);
                    }
                    this.updateSelectedCount();
                }
            }
        });
    }

    /**
     * 进入多选模式
     */
    enterMultiSelectMode(initialIdx) {
        if (this.multiSelectMode) return;
        this.multiSelectMode = true;
        this.selectedMessages.clear();
        // 选中当前长按/右键的消息
        const message = this.currentChat.messages[initialIdx];
        if (message) this.selectedMessages.add(message);
        // 重新渲染消息列表（显示复选框）
        this.renderMessages(this.currentChat);
        // 显示底部工具栏
        this.showMultiSelectToolbar();
    }

    /**
     * 切换消息选中状态
     */
    toggleMessageSelection(message) {
        if (this.selectedMessages.has(message)) {
            this.selectedMessages.delete(message);
        } else {
            this.selectedMessages.add(message);
        }
        this.updateSelectedCount();
    }

    /**
     * 显示多选工具栏
     */
    showMultiSelectToolbar() {
        const toolbar = document.getElementById('multi-select-toolbar');
        if (!toolbar) return;
        toolbar.style.display = 'flex';

        const cancelBtn = document.getElementById('cancel-multi-select');
        const deleteBtn = document.getElementById('delete-selected');
        const forwardBtn = document.getElementById('forward-selected');

        if (cancelBtn) {
            cancelBtn.onclick = () => this.exitMultiSelectMode();
        }

        if (deleteBtn) {
            deleteBtn.onclick = () => {
                if (this.selectedMessages.size === 0) {
                    this.showNotification('请选择要删除的消息');
                    return;
                }
                // 使用现有的 confirm-modal 组件
                const modal = document.getElementById('confirm-modal');
                const title = document.getElementById('confirm-modal-title');
                const message = document.getElementById('confirm-modal-message');
                const confirmBtn = document.getElementById('confirm-confirm-btn');
                const cancelBtn = document.getElementById('confirm-cancel-btn');

                if (!modal || !title || !message) return;

                title.textContent = '确认删除';
                message.textContent = `确定要删除选中的 ${this.selectedMessages.size} 条消息吗？此操作不可恢复。`;
                modal.classList.add('active');

                const onConfirm = () => {
                    this.deleteSelectedMessages();
                    modal.classList.remove('active');
                    confirmBtn.removeEventListener('click', onConfirm);
                    cancelBtn.removeEventListener('click', onCancel);
                };

                const onCancel = () => {
                    modal.classList.remove('active');
                    confirmBtn.removeEventListener('click', onConfirm);
                    cancelBtn.removeEventListener('click', onCancel);
                };

                confirmBtn.addEventListener('click', onConfirm);
                cancelBtn.addEventListener('click', onCancel);
            };
        }

        if (forwardBtn) {
            forwardBtn.onclick = () => {
                if (this.selectedMessages.size === 0) {
                    this.showNotification('请选择要转发的消息');
                    return;
                }
                this.forwardSelectedMessages();
            };
        }

        this.updateSelectedCount();
    }

    /**
     * 更新选中数量显示
     */
    updateSelectedCount() {
        const countEl = document.getElementById('selected-count');
        if (countEl) {
            countEl.textContent = `已选择 ${this.selectedMessages.size} 条`;
        }
        // 启用/禁用按钮
        const deleteBtn = document.getElementById('delete-selected');
        const forwardBtn = document.getElementById('forward-selected');
        if (deleteBtn) {
            deleteBtn.disabled = this.selectedMessages.size === 0;
        }
        if (forwardBtn) {
            forwardBtn.disabled = this.selectedMessages.size === 0;
        }
    }

    /**
     * 删除选中的消息
     */
    deleteSelectedMessages() {
        if (!this.currentChat || this.selectedMessages.size === 0) return;

        // 获取所有选中的消息索引（从大到小排序，避免删除时索引错乱）
        const sortedIndices = Array.from(this.selectedMessages)
            .map(msg => this.currentChat.messages.indexOf(msg))
            .filter(idx => idx !== -1)
            .sort((a, b) => b - a);

        // 删除消息
        sortedIndices.forEach(idx => {
            this.currentChat.messages.splice(idx, 1);
        });

        // 更新最后消息
        if (this.currentChat.messages.length > 0) {
            const lastMsg = this.currentChat.messages[this.currentChat.messages.length - 1];
            this.currentChat.lastMessage = lastMsg.text || lastMsg.content || '...';
            this.currentChat.lastTimestamp = lastMsg.timestamp;
        } else {
            this.currentChat.lastMessage = '';
            this.currentChat.lastTimestamp = null;
        }
        this.currentChat.lastTime = this.getRelativeTime(new Date());

        // 保存并重新渲染
        this.saveChats();
        this.exitMultiSelectMode();
        this.renderMessages(this.currentChat);
        this.renderChatList();

        this.showNotification('已删除选中的消息');
    }

    /**
     * 退出多选模式
     */
    exitMultiSelectMode() {
        this.multiSelectMode = false;
        this.selectedMessages.clear();
        const toolbar = document.getElementById('multi-select-toolbar');
        if (toolbar) toolbar.style.display = 'none';
        // 重新渲染消息列表（隐藏复选框）
        this.renderMessages(this.currentChat);
        // 清理事件监听器
        const container = document.getElementById('chat-messages');
        if (container) {
            container.querySelectorAll('.message-row').forEach(row => {
                if (row._contextHandler) {
                    row.removeEventListener('contextmenu', row._contextHandler);
                    delete row._contextHandler;
                }
                if (row._touchStartHandler) {
                    row.removeEventListener('touchstart', row._touchStartHandler);
                    delete row._touchStartHandler;
                }
                if (row._touchEndHandler) {
                    row.removeEventListener('touchend', row._touchEndHandler);
                    delete row._touchEndHandler;
                }
                if (row._touchMoveHandler) {
                    row.removeEventListener('touchmove', row._touchMoveHandler);
                    delete row._touchMoveHandler;
                }
            });
        }
    }

    /**
     * 查看原始消息（转发卡片点击）
     */
    viewOriginalMessage(originalChatId, timestamp) {
        // 这里可以实现查看原始消息的逻辑
        console.log('查看原始消息:', originalChatId, timestamp);
        this.showNotification('查看原始消息功能开发中');
    }

    /**
     * 查看转发详情（点击"查看详情"按钮）
     */
    viewForwardDetail(originalChatId, timestamp) {
        const forwardMsg = this.currentChat.messages.find(m => m.type === 'forward_card' && m.timestamp === timestamp);
        if (!forwardMsg) {
            this.showNotification('消息不存在');
            return;
        }

        // 判断是单条转发还是合并转发
        if (forwardMsg.messageCount === 1) {
            // 单条转发：直接解析 fullContent 构造一条消息
            const content = forwardMsg.fullContent;
            const colonIndex = content.indexOf('：');
            let sender = '未知', msgContent = content;
            if (colonIndex !== -1) {
                sender = content.substring(0, colonIndex);
                msgContent = content.substring(colonIndex + 1);
            }
            const messages = [{ sender, content: msgContent, isMe: (sender === this.mammySettings.nickname || sender === '我') }];

            // 生成与合并转发一致的 HTML 结构
            const messagesHtml = messages.map(msg => {
                const avatar = msg.isMe ? (this.mammySettings.avatar || '👤') : (forwardMsg.avatar || '👤');
                const displayName = msg.isMe ? (this.mammySettings.nickname || '我') : msg.sender;
                const rowClass = msg.isMe ? 'message-row right' : 'message-row left';
                return `
                    <div class="${rowClass}">
                        ${!msg.isMe ? `<div class="message-avatar">${avatar}</div>` : ''}
                        <div class="message-bubble-wrapper">
                            ${!msg.isMe ? `<div class="message-name">${displayName}</div>` : ''}
                            <div class="message-bubble ${msg.isMe ? 'sent' : 'received'}">${this.escapeHtml(msg.content)}</div>
                        </div>
                        ${msg.isMe ? `<div class="message-avatar">${avatar}</div>` : ''}
                    </div>
                `;
            }).join('');

            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content forward-detail-modal">
                    <div class="modal-header">
                        <h3>${this.escapeHtml(forwardMsg.cardTitle)}</h3>
                        <button class="close-btn" onclick="this.closest('.modal').classList.remove('active')">✕</button>
                    </div>
                    <div class="modal-body forward-detail-body">${messagesHtml}</div>
                    <div class="modal-footer">
                        <button class="cancel-btn" onclick="this.closest('.modal').classList.remove('active')">关闭</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            modal.classList.add('active');
        } else {
            // 合并转发：使用原有逻辑
            const originalChat = this.getChat(originalChatId);
            if (!originalChat) {
                this.showNotification('原聊天不存在或已被删除');
                return;
            }

            // 解析 fullContent 为消息数组，如果没有 fullContent 则使用 originalContent
            const content = forwardMsg.fullContent || `${forwardMsg.originalSender}：${forwardMsg.originalContent}`;
            const lines = content.split('\n');
            const messages = [];
            for (let line of lines) {
                const colonIndex = line.indexOf('：');
                if (colonIndex === -1) continue;
                const sender = line.substring(0, colonIndex);
                const content = line.substring(colonIndex + 1);
                const isMe = (sender === this.mammySettings.nickname || sender === '我');
                messages.push({ sender, content, isMe });
            }

            // 生成消息列表 HTML
            const messagesHtml = messages.map(msg => {
                const avatar = msg.isMe ? (this.mammySettings.avatar || '👤') : (originalChat.avatar || '👤');
                const displayName = msg.isMe ? (this.mammySettings.nickname || '我') : (originalChat.remarkName || originalChat.nickname || originalChat.name);
                const avatarContent = (avatar && typeof avatar === 'string' && (avatar.startsWith('http://') || avatar.startsWith('https://')))
                    ? `<img src="${avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`
                    : `<span>${avatar}</span>`;
                const rowClass = msg.isMe ? 'message-row right' : 'message-row left';
                return `
                    <div class="${rowClass}" style="margin-bottom: 12px;">
                        ${!msg.isMe ? `<div class="message-avatar" style="width: 36px; height: 36px; margin-right: 8px;">${avatarContent}</div>` : ''}
                        <div class="message-bubble-wrapper" style="max-width: 70%;">
                            ${!msg.isMe ? `<div class="message-name" style="font-size: 12px; margin-bottom: 2px;">${displayName}</div>` : ''}
                            <div class="message-bubble ${msg.isMe ? 'sent' : 'received'}" style="padding: 8px 12px; border-radius: 18px; background: ${msg.isMe ? 'var(--primary)' : 'var(--bg-page)'}; color: ${msg.isMe ? 'white' : 'var(--text-primary)'};">${this.escapeHtml(msg.content)}</div>
                        </div>
                        ${msg.isMe ? `<div class="message-avatar" style="width: 36px; height: 36px; margin-left: 8px;">${avatarContent}</div>` : ''}
                    </div>
                `;
            }).join('');

            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content forward-detail-modal">
                    <div class="modal-header">
                        <h3>${this.escapeHtml(forwardMsg.title)}</h3>
                        <button class="close-btn" onclick="this.closest('.modal').classList.remove('active')">✕</button>
                    </div>
                    <div class="modal-body forward-detail-body" style="padding: 12px; background: var(--bg-page);">
                        ${messagesHtml}
                    </div>
                    <div class="modal-footer">
                        <button class="submit-btn" onclick="chatManager.switchToChat('${originalChatId}')">跳转到原聊天</button>
                        <button class="cancel-btn" onclick="this.closest('.modal').classList.remove('active')">关闭</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            modal.classList.add('active');
        }
    }

    /**
     * 打开转发详情（点击转发卡片）
     */
    openForwardDetail(timestamp) {
        // 在当前聊天中查找转发卡片
        const msg = this.currentChat.messages.find(m => m.type === 'forward_card' && m.timestamp === timestamp);
        if (!msg || !msg.messages) return;

        // 创建模态框
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content forward-detail-modal">
                <div class="modal-header">
                    <h3>聊天记录</h3>
                    <button class="close-btn" onclick="this.closest('.modal').classList.remove('active')">✕</button>
                </div>
                <div class="modal-body forward-messages">
                    ${msg.messages.map(m => `
                        <div class="forward-message-item">
                            <div class="forward-message-sender">${m.senderName}</div>
                            <div class="forward-message-content">${this.escapeHtml(m.content)}</div>
                            <div class="forward-message-time">${new Date(m.timestamp).toLocaleTimeString()}</div>
                        </div>
                    `).join('')}
                </div>
                <div class="modal-footer">
                    <button class="cancel-btn" onclick="this.closest('.modal').classList.remove('active')">关闭</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.classList.add('active');
    }

    /**
     * 转发选中的消息
     */
    forwardSelectedMessages() {
        const selected = Array.from(this.selectedMessages);
        if (selected.length === 0) {
            this.showNotification('请选择要转发的消息');
            return;
        }
        this.showForwardSelectorForMessages(this.currentChat.id, selected);
    }

    /**
     * 显示目标聊天选择器（多条消息）
     */
    showForwardSelectorForMessages(chatId, messages) {
        // 获取所有聊天（排除自己和妈咪）
        const targetChats = this.contacts.filter(contact => {
            const isSelf = (contact.id === chatId);
            const isMummy = (contact.id === 'user_mummy');
            return !isSelf && !isMummy;
        }).map(contact => {
            // 获取对应的聊天对象（用于显示备注名等）
            const chat = this.getChat(contact.id);
            return {
                id: contact.id,
                name: chat ? (chat.remarkName || chat.nickname || chat.name) : contact.name,
                avatar: contact.avatar || '👤',
                isGroup: contact.isGroup
            };
        });

        if (targetChats.length === 0) {
            this.showNotification('没有可转发的聊天');
            return;
        }

        // 创建模态框
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'forward-select-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>选择转发对象</h3>
                    <button class="close-btn" onclick="this.closest('.modal').classList.remove('active')">✕</button>
                </div>
                <div class="modal-body" style="max-height: 60vh; overflow-y: auto;">
                    <div class="forward-contact-list">
                        ${targetChats.map(chat => `
                            <div class="forward-contact-item" data-id="${chat.id}">
                                <div class="forward-avatar">${chat.avatar}</div>
                                <div class="forward-name">${chat.name}</div>
                                ${chat.isGroup ? '<span class="forward-badge">群聊</span>' : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="cancel-btn" onclick="this.closest('.modal').classList.remove('active')">取消</button>
                    <button class="submit-btn" id="forward-confirm-btn" disabled>确认转发</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.classList.add('active');

        let selectedChatId = null;
        const items = modal.querySelectorAll('.forward-contact-item');
        const confirmBtn = modal.querySelector('#forward-confirm-btn');

        items.forEach(item => {
            item.addEventListener('click', () => {
                items.forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');
                selectedChatId = item.dataset.id;
                confirmBtn.disabled = false;
            });
        });

        confirmBtn.onclick = () => {
            if (selectedChatId) {
                this.forwardMessagesToChat(messages, selectedChatId);
                modal.remove();
            } else {
                this.showNotification('请选择一个聊天');
            }
        };
    }

    /**
     * 获取消息的纯文本内容（带类型标注）
     * @param {Object} msg 消息对象
     * @returns {string} 带类型标注的纯文本
     */
    getMessagePlainText(msg) {
        const sender = msg.isMe ? (this.mammySettings.nickname || '我') : (msg.senderName || '对方');
        let content = msg.text || msg.content || '';

        // 根据消息类型添加标注
        switch (msg.type) {
            case 'image_card':
            case 'image':
                content = `[图片] ${msg.cardDescription || msg.text || '[图片]'}`;
                break;
            case 'video_card':
            case 'video':
                content = `[视频] ${msg.cardDescription || msg.text || '[视频]'}`;
                break;
            case 'redpacket':
                const redPacket = msg.redPacket || {};
                content = `[红包] ${redPacket.message || '恭喜发财'} (总金额 ¥${redPacket.totalAmount || '0'})`;
                break;
            case 'dynamic_card':
            case 'dynamic':
                content = `[动态] ${msg.author || '作者'}：${msg.preview || msg.text || '[动态]'}`;
                break;
            case 'voice_card':
            case 'voice':
                content = `[心声] ${msg.text || '[语音消息]'}`;
                break;
            case 'transfer':
                content = `[转账] ¥${msg.transferAmount || '0'}`;
                break;
            case 'post_card':
            case 'post':
                content = `[帖子] ${msg.title || '帖子分享'}：${msg.preview || msg.text || ''}`;
                break;
            default:
                // 普通文本消息，直接使用内容
                content = msg.text || msg.content || '';
        }

        return `${sender}：${content}`;
    }

    /**
     * 获取消息类型的文本描述
     * @param {string} type 消息类型
     * @returns {string} 类型描述
     */
    getMessageTypeText(type) {
        switch (type) {
            case 'image_card':
            case 'image':
                return '图片';
            case 'video_card':
            case 'video':
                return '视频';
            case 'redpacket':
                return '红包';
            case 'dynamic_card':
            case 'dynamic':
                return '动态';
            case 'voice_card':
            case 'voice':
                return '心声';
            case 'transfer':
                return '转账';
            case 'post_card':
            case 'post':
                return '帖子';
            default:
                return '消息';
        }
    }

    /**
     * 执行转发：构造合并转发卡片并发送到目标聊天
     * @param {Array} messages 选中的消息数组
     * @param {string} targetChatId 目标聊天ID
     */
    async forwardMessagesToChat(messages, targetChatId) {
        const targetChat = this.getChat(targetChatId);
        if (!targetChat) return;

        // 获取当前聊天（原聊天）的名称
        const originalChatName = this.getDisplayName(this.currentChat);
        const myName = this.mammySettings.nickname || '我';
        const title = `${myName} 和 ${originalChatName} 的聊天记录`;

        // 构造消息列表预览（前3条）
        const previewMessages = messages.slice(0, 3).map(msg => {
            const sender = msg.isMe ? myName : originalChatName;
            const plainText = this.getMessagePlainText(msg);
            const content = plainText.substring(0, 50);
            return content;
        }).join('\n');
        const preview = previewMessages + (messages.length > 3 ? `\n... 共${messages.length}条消息` : `共${messages.length}条消息`);

        // 构造完整内容（供 AI 解析）
        const fullContent = messages.map(msg => this.getMessagePlainText(msg)).join('\n');

        const card = {
            type: 'forward_card',
            isMe: true,
            title: title,
            preview: preview,
            fullContent: fullContent,
            messageCount: messages.length,
            originalChatId: this.currentChat.id,
            timestamp: new Date().toISOString()
        };

        targetChat.messages.push(card);
        targetChat.lastMessage = `[聊天记录] ${title}`;
        targetChat.lastTimestamp = card.timestamp;
        if (!(this.currentChat && this.currentChat.id === targetChatId)) {
            targetChat.unreadCount = (targetChat.unreadCount || 0) + 1;
        }
        this.saveChats();
        this.renderChatList();
        if (this.currentChat && this.currentChat.id === targetChatId) {
            this.renderMessages(targetChat);
            this.scrollToBottom();
        }
        this.exitMultiSelectMode();
        this.showNotification('转发成功');

        // 触发 AI 回复（如果目标聊天是角色单聊）
        if (!targetChat.isGroup) {
            const aiPrompt = `你收到了一条合并转发的消息，来自 ${myName} 和 ${originalChatName} 的聊天记录，内容如下：\n${fullContent}\n\n请根据你的角色性格回复消息（可以是一句话，也可以是多句话，自然表达即可）。`;
            console.log('转发触发 AI, prompt:', aiPrompt);
            try {
                const reply = await this.callAI(targetChat.id, aiPrompt);
                if (reply) {
                    console.log('AI 回复:', reply);
                    this.addMessageWithEmotion(targetChat.id, reply);
                } else {
                    console.log('AI 无回复');
                    // 可选：发送默认回复
                    this.addMessage(targetChat.id, '收到一条转发消息', false);
                }
            } catch (err) {
                console.error('AI 调用失败', err);
                this.addMessage(targetChat.id, '收到一条转发消息', false);
            }
        }
    }

    /**
     * 更新消息渲染，添加转发卡片支持
     */
    renderForwardCard(message) {
        if (!message || message.type !== 'forward_card') return '';

        // 确定卡片图标
        let cardIcon = '💬';
        if (message.cardType === 'image') cardIcon = '🖼️';
        else if (message.cardType === 'video') cardIcon = '🎬';
        else if (message.cardType === 'post') cardIcon = '📝';

        return `
            <div class="forward-card">
                <div class="forward-card-header">${cardIcon} ${message.cardTitle}</div>
                <div class="forward-card-sender">来自：${message.originalSender}</div>
                <div class="forward-card-preview">${message.cardPreview}</div>
            </div>
        `;
    }

    /**
     * 心情日记功能
     */
    handleMoodDiary() {
        if (!this.currentChat) return;

        // 从动态中筛选心情类动态（包含表情符号）
        const moodDynamics = this.dynamics.filter(d =>
            d.authorId === this.currentChat.id &&
            (d.content.includes('😊') || d.content.includes('😢') || d.content.includes('😄') ||
             d.content.includes('😠') || d.content.includes('😰') || d.content.includes('😭'))
        );

        if (moodDynamics.length === 0) {
            this.showNotification('没有找到心情类动态');
            return;
        }

        // 创建心情日记模态框
        const modal = document.createElement('div');
        modal.id = 'mood-diary-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>😊 ${this.currentChat.name} 的心情日记</h3>
                    <button class="close-btn" onclick="this.closest('.modal').classList.remove('active')">✕</button>
                </div>
                <div class="modal-body" style="max-height: 400px; overflow-y: auto;">
                    ${moodDynamics.map(d => `
                        <div class="post-item" style="margin-bottom: 12px;">
                            <div class="post-avatar"><span>${d.avatar}</span></div>
                            <div class="post-content-wrapper">
                                <div class="post-author-info">
                                    <div class="post-author-name">${d.author}</div>
                                    <div class="post-time">${d.time}</div>
                                </div>
                                <div class="post-content" style="font-style: italic; color: #666;">${d.content}</div>
                                <div class="post-actions">
                                    <button class="like-btn ${d.isLiked ? 'liked' : ''}" onclick="chatManager.toggleLike('dynamic', ${d.id})">❤️ ${d.likes}</button>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div class="modal-footer">
                    <button class="cancel-btn" onclick="this.closest('.modal').classList.remove('active')">关闭</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // 显示模态框
        modal.classList.add('active');
    }

    /**
     * 最近音乐功能
     */
    handleRecentMusic() {
        if (!this.currentChat) return;

        // 从动态中筛选音乐类动态（包含🎵或"音乐"关键词）
        const musicDynamics = this.dynamics.filter(d =>
            d.authorId === this.currentChat.id &&
            (d.content.includes('🎵') || d.content.toLowerCase().includes('音乐') || d.content.toLowerCase().includes('song'))
        );

        if (musicDynamics.length === 0) {
            this.showNotification('没有找到音乐类动态');
            return;
        }

        // 创建音乐列表模态框
        const modal = document.createElement('div');
        modal.id = 'music-list-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>🎵 ${this.currentChat.name} 的最近音乐</h3>
                    <button class="close-btn" onclick="this.closest('.modal').classList.remove('active')">✕</button>
                </div>
                <div class="modal-body" style="max-height: 400px; overflow-y: auto;">
                    ${musicDynamics.map(d => `
                        <div class="post-item" style="margin-bottom: 12px;">
                            <div class="post-avatar"><span>${d.avatar}</span></div>
                            <div class="post-content-wrapper">
                                <div class="post-author-info">
                                    <div class="post-author-name">${d.author}</div>
                                    <div class="post-time">${d.time}</div>
                                </div>
                                <div class="post-content" style="color: #667eea;">${d.content}</div>
                                <div class="post-actions">
                                    <button class="like-btn ${d.isLiked ? 'liked' : ''}" onclick="chatManager.toggleLike('dynamic', ${d.id})">❤️ ${d.likes}</button>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div class="modal-footer">
                    <button class="cancel-btn" onclick="this.closest('.modal').classList.remove('active')">关闭</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // 显示模态框
        modal.classList.add('active');
    }

    /**
     * 发布动态（文本）
     */
    async postTextDynamic(content) {
        if (!this.currentChat || !content) return;

        const dynamic = {
            id: Date.now(),
            author: this.currentChat.name,
            avatar: this.currentChat.avatar || '👤',
            content: content,
            type: 'text',
            timestamp: new Date().toISOString(),
            likes: 0,
            comments: 0,
            isLiked: false,
            authorId: this.currentChat.id
        };

        this.dynamics.push(dynamic);
        this.dynamics.sort((a, b) => b.timestamp - a.timestamp); // 按时间倒序
        this.saveChats();
        this.renderDynamics();

        // 如果启用了自动回复，生成AI回复
        if (this.mammySettings.autoGenerate?.forum?.enabled) {
            setTimeout(() => {
                this.generateDynamicComment(dynamic);
            }, 2000);
        }

        console.log(`动态发布成功: ${content}`);
        return dynamic;
    }

    /**
     * 发布动态（图片）
     */
    async postImageDynamic(description) {
        if (!this.currentChat) return;

        const dynamic = {
            id: Date.now(),
            author: this.currentChat.name,
            avatar: this.currentChat.avatar || '👤',
            content: `📷 ${description}`,
            type: 'image',
            description: description,
            timestamp: new Date().toISOString(),
            likes: 0,
            comments: 0,
            isLiked: false,
            authorId: this.currentChat.id
        };

        this.dynamics.push(dynamic);
        this.dynamics.sort((a, b) => b.timestamp - a.timestamp);
        this.saveChats();
        this.renderDynamics();

        console.log(`图片动态发布成功: ${description}`);
        return dynamic;
    }

    /**
     * 生成动态评论
     */
    async generateDynamicComment(dynamic) {
        try {
            // 获取该角色的频率设置
            const freq = this.mammySettings.autoGenerate?.forum?.ocFrequencies?.[dynamic.authorId] || 0;
            if (Math.random() > freq / 10) return; // 频率控制

            const systemPrompt = `你是一个围观群众，看到${dynamic.author}的动态"${dynamic.content}"，请根据你的角色性格回复一句简短的评论。`;
            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: '请发表评论' }
            ];

            const response = await fetch(this.mammySettings.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.mammySettings.apiKey}`
                },
                body: JSON.stringify({
                    model: this.mammySettings.modelName,
                    messages: messages,
                    temperature: 0.7,
                                    })
            });

            const data = await response.json();
            const comment = data.choices[0].message.content;

            // 增加评论计数
            dynamic.comments += 1;
            this.saveChats();
            this.renderDynamics();

        } catch (error) {
            console.error('生成动态评论失败:', error);
        }
    }

    /**
     * 拉黑用户（仅单聊）
     */
    handleBlockUser() {
        if (!this.currentChat || this.currentChat.isGroup) {
            this.showNotification('拉黑功能仅适用于单聊');
            return;
        }

        const isBlocked = this.blockedUsers?.includes(this.currentChat.id);
        if (isBlocked) {
            this.unblockUser(this.currentChat.id);
        } else {
            this.blockUser(this.currentChat.id);
        }
    }

    /**
     * 拉黑用户逻辑
     */
    async blockUser(chatId) {
        const chat = this.getChat(chatId);
        if (!chat) return;

        // 调用 AI 生成拉黑时的角色回复
        if (chat.isOnline !== false) {
            const aiReply = await this.callAI(chatId, '用户将你拉黑了，请根据你的角色性格回复一条伤心的消息（如质问、哭泣等），不要超过30字。');
            if (aiReply) {
                this.addMessageWithEmotion(chatId, aiReply);
            } else {
                // 降级
                this.addMessage(chatId, '为什么...为什么要这样对我？😭', false);
            }
        }

        // 添加到拉黑列表
        if (!this.blockedUsers) this.blockedUsers = [];
        if (!this.blockedUsers.includes(chatId)) {
            this.blockedUsers.push(chatId);
        }

        // 隐藏聊天（从消息列表移除）
        chat.isHidden = true;
        this.saveChats();

        // 关闭聊天窗口
        this.closeChat();

        // 更新聊天列表
        this.renderChatList();

        console.log(`已拉黑用户: ${chat.name}`);
    }

    /**
     * 解除拉黑
     */
    async unblockUser(chatId) {
        const chat = this.getChat(chatId);
        if (!chat) return;

        // 从拉黑列表移除
        if (this.blockedUsers) {
            this.blockedUsers = this.blockedUsers.filter(id => id !== chatId);
        }

        // 恢复聊天显示
        chat.isHidden = false;
        this.saveChats();

        // 调用 AI 生成解除拉黑的回复
        const aiReply = await this.callAI(chatId, '用户解除了对你的拉黑，请根据你的角色性格回复一条消息（如感激、傲娇、害羞等），不要超过30字。');
        if (aiReply) {
            this.addMessageWithEmotion(chatId, aiReply);
        } else {
            // 降级
            const unblockMessages = {
                '薛厉': '太好了！妈咪终于原谅我了！😊',
                '廉诚': '哼，还算你有点良心。😌',
                '默认': '谢谢你还愿意理我，我会好好表现的！🥰'
            };
            const fallback = unblockMessages[chat.name] || unblockMessages['默认'];
            this.addMessage(chatId, fallback, false);
        }

        // 更新聊天列表
        this.renderChatList();

        console.log(`已解除拉黑用户: ${chat.name}`);
    }

    /**
     * 心声功能
     */
    handleVoiceThoughts() {
        if (!this.currentChat) return;

        const modal = document.getElementById('voice-thoughts-modal');
        if (!modal) {
            this.createVoiceThoughtsModal();
        } else {
            modal.classList.add('active');
            this.generateVoiceThoughts();
        }
    }

    /**
     * 创建心声模态框
     */
    createVoiceThoughtsModal() {
        const modal = document.createElement('div');
        modal.id = 'voice-thoughts-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>💭 ${this.currentChat.name} 的心声</h3>
                    <button class="close-btn" onclick="this.closest('.modal').classList.remove('active')">✕</button>
                </div>
                <div class="modal-body">
                    <div id="voice-thoughts-content" style="min-height: 100px; display: flex; align-items: center; justify-content: center;">
                        <div class="spinner" style="width: 20px; height: 20px;"></div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="cancel-btn" onclick="this.closest('.modal').classList.remove('active')">关闭</button>
                    <button class="submit-btn" id="send-voice-thoughts-btn">发送到聊天</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // 生成心声
        this.generateVoiceThoughts();
    }

    /**
     * 生成心声内容
     */
    async generateVoiceThoughts() {
        if (!this.currentChat) return;

        const contentDiv = document.getElementById('voice-thoughts-content');
        if (!contentDiv) return;

        try {
            // 获取最近的消息作为上下文
            const recentMessages = this.currentChat.messages.slice(-10);
            const context = recentMessages.map(msg => ({
                role: msg.isMe ? 'user' : 'assistant',
                content: msg.text || msg.content || ''
            }));

            const systemPrompt = `你是${this.currentChat.name}，现在请说出你的内心真实想法（心声）。
            根据你的角色性格和与妈咪的对话历史，表达你此刻的真实感受和想法。
            请用第一人称，简洁自然地表达。`;

            const messages = [
                { role: 'system', content: systemPrompt },
                ...context,
                { role: 'user', content: '请说出你的内心真实想法（心声）' }
            ];

            const response = await fetch(this.mammySettings.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.mammySettings.apiKey}`
                },
                body: JSON.stringify({
                    model: this.mammySettings.modelName,
                    messages: messages,
                    temperature: 0.7,
                                    })
            });

            const data = await response.json();
            const thoughts = data.choices[0].message.content;

            contentDiv.innerHTML = `<p style="font-style: italic; color: #666; line-height: 1.6;">${thoughts}</p>`;

        } catch (error) {
            console.error('生成心声失败:', error);
            contentDiv.innerHTML = '<p style="color: #999;">生成心声失败，请重试</p>';
        }
    }

    /**
     * 发送心声到聊天
     */
    async sendVoiceThoughtsToChat(memberId = null, preGeneratedThoughts = null) {
        const chat = this.currentChat;
        if (!chat) return;

        const targetId = memberId || (chat.isGroup ? null : chat.id);
        if (!targetId) {
            this.showNotification('无法确定心声对象');
            return;
        }

        const targetChat = this.getChat(targetId);
        if (!targetChat) {
            this.showNotification('找不到目标角色');
            return;
        }

        let rawThoughts = preGeneratedThoughts;
        // 如果没有预先传入心声，则走生成流程
        if (!rawThoughts) {
            // 显示加载状态（如果模态框存在）
            const modal = document.getElementById('voice-thoughts-modal');
            const contentDiv = document.getElementById('voice-thoughts-content');
            if (modal && contentDiv) {
                contentDiv.innerHTML = `
                    <div style="text-align: center;">
                        <div class="spinner" style="width: 30px; height: 30px;"></div>
                        <p style="margin-top: 15px; color: var(--text-secondary);">正在生成 ${targetChat.name} 的心声...</p>
                    </div>
                `;
                modal.classList.add('active');
            }

            try {
                // 生成心声内容
                const prompt = `请模拟${targetChat.name}的内心独白。基于以下设定：
- 角色性格：${targetChat.personalityPrompt || '未知'}
- 当前场景：${chat.isGroup ? '在群聊中' : '在私聊中'}
- 内心活动：表达真实想法、感受或观察

请生成一段第一人称的内心独白，风格要符合角色性格，内容可以是：
1. 对当前聊天的看法
2. 对某个事件的感受
3. 对他人行为的观察
4. 个人心情或想法

要求：简洁真实，不超过80字，用口语化表达，体现角色个性。`;

                rawThoughts = await this.callAI(targetId, prompt);
                if (!rawThoughts) {
                    throw new Error('生成心声失败');
                }
            } catch (error) {
                console.error('生成心声失败:', error);
                const modal = document.getElementById('voice-thoughts-modal');
                if (modal) modal.classList.remove('active');
                this.showNotification('生成心声失败，请重试');
                return;
            }
        }

        // 清理内容
        const cleanThoughts = rawThoughts.replace(/\[emotion:.*?\]/gi, '').trim();

        // 创建心声消息（由妈咪发送）
        const message = {
            id: Date.now() + Math.random(),
            text: cleanThoughts,
            time: this.getRelativeTime(new Date()),
            isMe: true,
            type: 'voice_card',
            cardContent: cleanThoughts,
            timestamp: new Date().toISOString()
        };

        // 添加到当前聊天
        chat.messages.push(message);
        this.saveChats();
        this.renderMessages(chat);
        this.scrollToBottom();

        console.log(`心声卡片已发送（目标角色：${targetChat.name}，由妈咪发送）`);

        // 关闭模态框
        const modal = document.getElementById('voice-thoughts-modal');
        if (modal) modal.classList.remove('active');

        // 触发后续互动
        if (chat.isGroup) {
            // 【关键修复】为群聊添加明确的上下文标注
            const contextualTrigger = `（妈咪公开了 ${targetChat.name} 的心声："${cleanThoughts}"）`;
            setTimeout(() => {
                this.triggerGroupReplies(chat.id, contextualTrigger);
            }, 1000);
        } else {
            // 单聊：触发目标角色的回复
            this.callAI(chat.id, `你的内心独白被妈咪公开了："${cleanThoughts}"。请根据你的角色性格回复一条消息（可能感到害羞、恼怒、感动、尴尬等）。`).then(async (aiReply) => {
                if (aiReply) {
                    await this.addMessageWithEmotion(chat.id, aiReply, false, null, { skipEmotion: true });
                }
            }).catch(error => {
                console.error('AI回复失败:', error);
            });
        }
    }

    /**
     * 重新回复（回溯）功能
     */
    handleReplyBack() {
        if (!this.currentChat) return;

        const modal = document.getElementById('reply-back-modal');
        if (!modal) {
            this.createReplyBackModal();
        } else {
            modal.classList.add('active');
            this.renderReplyBackList();
        }
    }

    /**
     * 创建回溯模态框
     */
    createReplyBackModal() {
        const modal = document.createElement('div');
        modal.id = 'reply-back-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>选择回溯点</h3>
                    <button class="close-btn" onclick="this.closest('.modal').classList.remove('active')">✕</button>
                </div>
                <div class="modal-body">
                    <p style="margin-bottom: 12px; color: #666;">选择一条消息作为回溯点（该消息之后的所有消息将被删除）</p>
                    <div id="reply-back-list">
                        <!-- 消息列表将动态生成 -->
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="cancel-btn" onclick="this.closest('.modal').classList.remove('active')">取消</button>
                    <button class="submit-btn" id="confirm-reply-back-btn" disabled>确认回溯</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // 渲染消息列表
        this.renderReplyBackList();
    }

    /**
     * 渲染回溯消息列表
     */
    renderReplyBackList() {
        if (!this.currentChat) return;

        const container = document.getElementById('reply-back-list');
        if (!container) return;

        const messages = this.currentChat.messages.slice(-10); // 最近10条消息
        container.innerHTML = '';

        messages.forEach((msg, index) => {
            const item = document.createElement('div');
            item.className = 'reply-back-item';
            item.style.cssText = `
                padding: 8px 12px;
                border: 1px solid #ddd;
                border-radius: 8px;
                margin-bottom: 8px;
                cursor: pointer;
                transition: all 0.2s;
            `;

            const sender = msg.isMe ? '妈咪' : (msg.memberId ? this.getChat(msg.memberId)?.name : this.currentChat.name);
            const timeStr = this.getRelativeTime(new Date(msg.timestamp));
            const preview = (msg.text || msg.content || '').substring(0, 50) + (msg.text?.length > 50 ? '...' : '');

            item.innerHTML = `
                <div style="font-size: 12px; color: #999; margin-bottom: 4px;">${sender} · ${timeStr}</div>
                <div style="font-size: 14px;">${preview}</div>
            `;

            item.onclick = () => {
                // 选中效果
                document.querySelectorAll('.reply-back-item').forEach(el => {
                    el.style.background = '#fff';
                    el.style.borderColor = '#ddd';
                });
                item.style.background = '#e3f2fd';
                item.style.borderColor = '#2196f3';

                // 启用确认按钮
                document.getElementById('confirm-reply-back-btn').disabled = false;

                // 保存选中的消息ID（使用 timestamp 作为唯一标识）
                this.selectedReplyBackMessageId = msg.timestamp;
            };

            container.appendChild(item);
        });
    }

    /**
     * 确认回溯
     */
    async confirmReplyBack() {
        if (!this.currentChat || !this.selectedReplyBackMessageId) return;
        const chat = this.currentChat;
        const backIndex = chat.messages.findIndex(m => m.timestamp === this.selectedReplyBackMessageId);
        if (backIndex === -1) return;
        const backMessage = chat.messages[backIndex];
        // 删除回溯点之后的所有消息
        chat.messages = chat.messages.slice(0, backIndex + 1);
        this.saveChats();
        this.renderMessages(chat);
        // 如果回溯点是一条用户消息，则重新生成AI回复
        if (backMessage && backMessage.isMe) {
            const reply = await this.callAI(chat.id, backMessage.text);
            if (reply) {
                // 使用 addMessageWithEmotion 处理可能的情绪标签
                this.addMessageWithEmotion(chat.id, reply);
            }
        }
        this.scrollToBottom();
        this.closeReplyBackModal();
    }

    /**
     * 智能分割文本为句子（按句号分割，但保留句尾标点）
     */
    splitIntoSentences(text) {
        if (!text) return [];
        // 优先按换行符分割
        if (text.includes('\n')) {
            return text.split('\n').map(s => s.trim()).filter(s => s.length > 0);
        }

        // 优先使用后向断言正则（现代浏览器）
        if (/(?<=。)/.test('。')) {
            // 按句号分割，保留句号
            let sentences = text.split(/(?<=。)/g);
            sentences = sentences.map(s => s.trim()).filter(s => s.length > 0);
            // 如果分割后没有结果（比如没有句号），直接返回原文本
            if (sentences.length === 0 && text.trim().length > 0) return [text.trim()];
            return sentences;
        } else {
            // 兼容旧浏览器的回退方案：保持原有逻辑但简化
            const sentences = [];
            let current = '';
            for (let i = 0; i < text.length; i++) {
                current += text[i];
                if (text[i] === '。') {
                    sentences.push(current);
                    current = '';
                }
            }
            if (current.trim()) sentences.push(current);
            return sentences.length ? sentences : [text];
        }

        // 添加最后一句
        if (currentSentence.trim()) {
            sentences.push(currentSentence);
        }

        // 如果没有分割出任何句子，返回整个文本
        return sentences.length > 0 ? sentences : [text];
    }

    /**
     * 添加消息并处理情绪标签（复用 flushPendingMessages 中的逻辑）
     */
    addMessageWithEmotion(chatId, replyText, isMe = false, senderId = null, options = {}) {
        const { skipEmotion = false } = options; // 从 options 中获取 skipEmotion 参数，默认为 false
        const chat = this.getChat(chatId);
        if (!chat) return;

        // 防御性检查：过滤 __GROUP_TRIGGERED__ 和空内容
        if (!replyText || replyText === '__GROUP_TRIGGERED__') return;

        console.log('addMessageWithEmotion chatId:', chatId, 'senderId:', senderId);
        // 获取最近5条消息用于去重判断
        const recentMessages = chat.messages.slice(-5);

        // 检查是否是红包相关的系统消息或角色回复，如果是，则放宽去重限制
        const isRedPacketContext = chat.isGroup &&
            (replyText.includes('红包') || replyText.includes('🧧') ||
             recentMessages.some(m => m.isSystem && m.text?.includes('红包')));

        if (!isRedPacketContext && recentMessages.some(msg => msg.text === replyText || msg.text?.includes(replyText))) {
            console.log('检测到重复消息，跳过添加');
            return;
        }

        // 检测拍一拍操作（所有群成员可用）
        if (chat.isGroup && senderId) {
            const patMatch = replyText.match(/\[action:pat\s+@(\S+)\]/i);
            if (patMatch) {
                const targetName = patMatch[1];

                // 特殊处理：拍妈咪
                if (targetName === '妈咪') {
                    this.patMammyInGroup(senderId);
                    // 从回复文本中移除标签
                    replyText = replyText.replace(patMatch[0], '').trim();
                } else {
                    // 查找目标成员ID
                    let targetMemberId = null;
                    if (chat.members) {
                        // 首先尝试按显示名称匹配
                        for (let memberId of chat.members) {
                            const info = this.getMemberDisplayInfo(memberId);
                            if (info.name === targetName) {
                                targetMemberId = memberId;
                                break;
                            }
                        }

                        // 如果按名称匹配失败，尝试按成员ID直接匹配
                        if (!targetMemberId) {
                            // 检查 targetName 是否与任何成员 ID 相等（适用于 NPC 名称与 ID 相同的情况）
                            if (chat.members.includes(targetName)) {
                                targetMemberId = targetName;
                            } else {
                                // 如果 AI 输出的标签中使用的是 NPC 的显示名称，但 NPC ID 是另一种格式，
                                // 可以尝试在 members 中查找 ID 包含 targetName 的成员（模糊匹配，谨慎使用）
                                for (let memberId of chat.members) {
                                    if (memberId.includes(targetName)) {
                                        targetMemberId = memberId;
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    // 特殊处理：自拍（目标成员ID与发送者相同）
                    if (targetMemberId === senderId) {
                        this.patSelfInGroup(senderId);
                        // 从回复文本中移除标签
                        replyText = replyText.replace(patMatch[0], '').trim();
                    } else if (!targetMemberId) {
                        console.warn(`拍一拍失败：未找到成员 "${targetName}"`);
                        // 未找到成员时不执行操作，但移除标签
                        replyText = replyText.replace(patMatch[0], '').trim();
                    } else {
                        // 执行拍一拍操作，传入拍人者ID
                        this.patGroupMember(targetMemberId, senderId);
                        // 从回复文本中移除标签
                        replyText = replyText.replace(patMatch[0], '').trim();
                    }
                }
            }
        }

        // 检测拍一拍操作（单聊中拍妈咪）
        if (!chat.isGroup) {
            const patMatch = replyText.match(/\[action:pat\s+@(\S+)\]/i);
            if (patMatch) {
                const targetName = patMatch[1];

                // 确定操作者ID（单聊中AI回复时senderId可能为null，使用chat.id）
                const operatorId = senderId || chat.id;

                // 单聊中只处理拍妈咪和自拍
                if (targetName === '妈咪') {
                    // 调用单聊拍妈咪函数
                    this.patMammyInChat(chatId, operatorId);
                    // 从回复文本中移除标签
                    replyText = replyText.replace(patMatch[0], '').trim();
                    // 【注意】这里绝对不能有 return，必须继续处理剩余文本
                } else if (targetName === '自己' || targetName === operatorId) {
                    // 调用单聊自拍函数
                    this.patSelfInChat(chatId, operatorId);
                    // 从回复文本中移除标签
                    replyText = replyText.replace(patMatch[0], '').trim();
                    // 【注意】这里绝对不能有 return，必须继续处理剩余文本
                } else {
                    console.warn(`单聊中拍一拍失败：未找到目标 "${targetName}"`);
                    // 移除标签
                    replyText = replyText.replace(patMatch[0], '').trim();
                }
            }
        }

        // 检测红包操作（群聊中任何成员可用）- 提前到管理操作之前
        if (chat.isGroup && senderId) {
            const rpMatch = replyText.match(/\[action:redpacket\s+type=(\w+)\s+amount=(\d+)\s+count=(\d+)\s+message=(.+?)\]/i);
            if (rpMatch) {
                const type = rpMatch[1];        // normal, lucky, exclusive
                const amount = parseInt(rpMatch[2]);
                const count = parseInt(rpMatch[3]);
                const message = rpMatch[4].trim();

                // 解析专属红包的目标成员（从原始 replyText 中匹配 @昵称）
                let targetMemberId = null;
                if (type === 'exclusive') {
                    // 从原始 replyText 中匹配 @昵称
                    const mentionMatch = replyText.match(/@(\S+)/);
                    if (mentionMatch) {
                        const mentionedName = mentionMatch[1];
                        // 在群成员中查找匹配的 ID
                        const member = chat.members.find(id => {
                            const info = this.getMemberDisplayInfo(id);
                            return info.name === mentionedName;
                        });
                        targetMemberId = member || null;
                    }
                }

                // 调用发红包方法，传入发送者ID和目标成员ID
                this.sendRedPacketAsMember(chat.id, senderId, type, amount, count, message, targetMemberId);
                // 从回复文本中移除标签
                replyText = replyText.replace(rpMatch[0], '').trim();
            }
        }

        // 检测并处理管理操作标签（仅群聊且发送者为管理员）
        if (chat.isGroup && senderId && chat.admins && chat.admins.includes(senderId)) {
            // 检测禁言操作
            const muteMatch = replyText.match(/\[action:mute\s+@(\S+)\s+(\S+?)\]/i);
            if (muteMatch) {
                const targetName = muteMatch[1];
                const duration = muteMatch[2];
                // 查找目标成员ID
                let targetMemberId = null;
                if (chat.members) {
                    for (let memberId of chat.members) {
                        const info = this.getMemberDisplayInfo(memberId);
                        if (info.name === targetName) {
                            targetMemberId = memberId;
                            break;
                        }
                    }
                }
                if (!targetMemberId) {
                    console.warn(`管理员尝试操作不存在的成员：${targetName}`);
                } else if (targetMemberId === 'user_mummy') {
                    console.warn('禁言失败：不能对妈咪执行禁言');
                } else if (targetMemberId === senderId) {
                    console.warn('禁言失败：不能对自己执行禁言');
                } else {
                    // 将时长转换为毫秒
                    let durationMs;
                    if (duration === 'forever') {
                        durationMs = 'forever';
                    } else {
                        // 尝试解析分钟
                        const minutes = parseInt(duration);
                        if (!isNaN(minutes)) {
                            durationMs = minutes * 60000;
                        } else {
                            // 如果无法解析，默认5分钟
                            durationMs = 5 * 60000;
                        }
                    }
                    // 执行禁言操作，传入操作者ID
                    this.muteGroupMember(targetMemberId, durationMs, senderId);
                }
                // 只有成功找到并执行操作时才从回复文本中移除标签
                if (targetMemberId && targetMemberId !== 'user_mummy' && targetMemberId !== senderId) {
                    replyText = replyText.replace(muteMatch[0], '').trim();
                }
            }

            // 检测踢人操作
            const kickMatch = replyText.match(/\[action:kick\s+@(\S+)\]/i);
            if (kickMatch) {
                const targetName = kickMatch[1];
                // 查找目标成员ID
                let targetMemberId = null;
                if (chat.members) {
                    for (let memberId of chat.members) {
                        const info = this.getMemberDisplayInfo(memberId);
                        if (info.name === targetName) {
                            targetMemberId = memberId;
                            break;
                        }
                    }
                }
                if (!targetMemberId) {
                    console.warn(`管理员尝试操作不存在的成员：${targetName}`);
                } else if (targetMemberId === 'user_mummy') {
                    console.warn('踢人失败：不能对妈咪执行踢出');
                } else if (targetMemberId === senderId) {
                    console.warn('踢人失败：不能对自己执行踢出');
                } else {
                    // 执行踢人操作，传入操作者ID
                    this.removeMemberFromGroup(targetMemberId, senderId);
                }
                // 只有成功找到并执行操作时才从回复文本中移除标签
                if (targetMemberId && targetMemberId !== 'user_mummy' && targetMemberId !== senderId) {
                    replyText = replyText.replace(kickMatch[0], '').trim();
                }
            }

            // 检测修改群公告操作
            const noticeMatch = replyText.match(/\[action:notice\s+(.+?)\]/i);
            if (noticeMatch) {
                const newNotice = noticeMatch[1];
                this.updateGroupNotice(chatId, newNotice, senderId);
                replyText = replyText.replace(noticeMatch[0], '').trim();
            }

            // 检测修改群名称操作
            const renameMatch = replyText.match(/\[action:rename\s+(.+?)\]/i);
            if (renameMatch) {
                const newName = renameMatch[1];
                this.renameGroup(chatId, newName, senderId);
                replyText = replyText.replace(renameMatch[0], '').trim();
            }
        }

        // 剥离情绪标签（支持带空格和不带空格）
        let emotionTag = null;
        let cleanReply = replyText;
        const emotionMatch = replyText.match(/\[emotion:\s*(\w+)\s*\]/i);
        if (emotionMatch) {
            emotionTag = emotionMatch[1].toLowerCase();
            cleanReply = replyText.replace(emotionMatch[0], '').trim();
        }
        // 再次确保没有残留标签
        cleanReply = cleanReply.replace(/\[emotion:.*?\]/gi, '').trim();
        cleanReply = cleanReply.replace(/\[action:.*?\]/gi, '').trim();  // 新增这行

        // 智能分割文本消息
        const bubbleTexts = this.splitIntoSentences(cleanReply);

        // 依次发送文本消息
        bubbleTexts.forEach((bubbleText, i) => {
            setTimeout(() => {
                this.addMessage(chatId, bubbleText, isMe, senderId);
            }, i * 500);
        });

        // 发送表情消息 (关键修改：增加 !skipEmotion 的判断条件)
        if (emotionTag) {
            setTimeout(() => {
                // 关键修改：增加 !skipEmotion 的判断条件
                if (!skipEmotion) {
                    let memberChat = null;
                    if (senderId) {
                        memberChat = this.getChat(senderId);
                        // 如果是NPC且getChat返回undefined，使用getMemberDisplayInfo获取信息
                        if (!memberChat && senderId.startsWith('npc_')) {
                            const npcInfo = this.getMemberDisplayInfo(senderId);
                            if (npcInfo.isNPC) {
                                // 构造临时成员对象
                                memberChat = {
                                    id: senderId,
                                    name: npcInfo.name,
                                    avatar: npcInfo.avatar,
                                    isNPC: true
                                };
                            }
                        }
                    }
                    // 发送表情时，如果成员对象存在则传入成员对象（用于频率），但实际添加到群聊
                    this.sendEmotionByTagForGroup(chatId, memberChat || chat, emotionTag);
                }
            }, bubbleTexts.length * 500);
        }
    }

    /**
     * 发送表情消息（用于群聊场景）
     * @param {string} groupChatId 群聊ID（用于添加消息到群聊）
     * @param {Object} memberChat 成员对象（用于读取频率设置和映射）
     * @param {string} emotionTag 情绪标签
     */
    sendEmotionByTagForGroup(groupChatId, memberChat, emotionTag) {
        // 情绪标签映射：将 AI 可能输出的、但不在表情库中的情绪映射到已有的分组
        const emotionMapping = {
            'touched': 'happy',   // 感动 → 开心
            'excited': 'happy',
            'nostalgic': 'sad',
            'lonely': 'sad',
            'anxious': 'sad',
            'proud': 'happy',
            'embarrassed': 'sad',
            'frustrated': 'angry',
            'calm': 'happy',
            'hopeful': 'happy',
            'jealous': 'sad',
            'disappointed': 'sad',
            'confused': 'surprised',
            'bored': 'sad',
            'tired': 'sad',
            'energetic': 'happy',
            'curious': 'happy',
            'grateful': 'happy',
            'annoyed': 'angry',
            'scared': 'sad',
            'worried': 'sad',
            'relaxed': 'happy',
            'amused': 'happy',
            'sympathetic': 'sad',
            'shocked': 'surprised',
            'envious': 'sad',
            'betrayed': 'angry',
            'adored': 'happy',
            'rejected': 'sad',
            'accepted': 'happy',
            'free': 'happy',
            'trapped': 'sad',
            'peaceful': 'happy',
            'restless': 'sad'
        };
        if (emotionMapping[emotionTag]) {
            emotionTag = emotionMapping[emotionTag];
            console.log(`情绪标签映射: ${arguments[2]} -> ${emotionTag}`);
        }

        // 中文情绪标签映射到英文
        const chineseToEnglish = {
            '委屈': 'sad',
            '警惕': 'surprised',
            '开心': 'happy',
            '高兴': 'happy',
            '快乐': 'happy',
            '伤心': 'sad',
            '难过': 'sad',
            '悲伤': 'sad',
            '生气': 'angry',
            '愤怒': 'angry',
            '惊讶': 'surprised',
            '惊奇': 'surprised',
            '兴奋': 'excited',
            '感动': 'touched',
            '孤独': 'lonely',
            '寂寞': 'lonely',
            '焦虑': 'anxious',
            '紧张': 'anxious',
            '自豪': 'proud',
            '骄傲': 'proud',
            '尴尬': 'embarrassed',
            '挫败': 'frustrated',
            '怀念': 'nostalgic',
            '平静': 'calm',
            '冷静': 'calm',
            '希望': 'hopeful',
            '嫉妒': 'jealous',
            '失望': 'disappointed',
            '困惑': 'confused',
            '无聊': 'bored',
            '疲惫': 'tired',
            '活力': 'energetic',
            '好奇': 'curious',
            '感激': 'grateful',
            '感谢': 'grateful',
            '烦躁': 'annoyed',
            '害怕': 'scared',
            '恐惧': 'scared',
            '担心': 'worried',
            '放松': 'relaxed',
            '被逗乐': 'amused',
            '同情': 'sympathetic',
            '震惊': 'shocked',
            '羡慕': 'envious',
            '背叛': 'betrayed',
            '被宠爱': 'adored',
            '被拒绝': 'rejected',
            '被接纳': 'accepted',
            '自由': 'free',
            '受困': 'trapped',
            '安宁': 'peaceful',
            '不安': 'restless'
        };

        // 如果传入的 emotionTag 是中文，尝试映射为英文
        if (chineseToEnglish[emotionTag]) {
            console.log(`中文情绪标签映射: ${emotionTag} -> ${chineseToEnglish[emotionTag]}`);
            emotionTag = chineseToEnglish[emotionTag];
        }

        // 检查表情频率（使用成员对象或群聊对象的 emojiFreq）
        if (memberChat && memberChat.emojiFreq !== undefined && memberChat.emojiFreq !== null) {
            if (Math.random() > memberChat.emojiFreq) {
                console.log('表情频率未命中，不发送表情');
                return;
            }
        } else if (memberChat && memberChat.emojiFreq === 0) {
            console.log('表情频率为0，不发送表情');
            return;
        }

        // 从对应分组获取表情列表
        const emotions = this.mammySettings?.emotions || {};
        const emotionList = emotions[emotionTag] || [];
        if (!emotionList.length) {
            console.log(`未找到情绪标签 "${emotionTag}" 对应的表情，尝试默认分组`);
            const defaultEmotions = emotions['sad'] || ['😢', '😭', '😔'];
            const randomEmoji = defaultEmotions[Math.floor(Math.random() * defaultEmotions.length)];
            this.addMessage(groupChatId, randomEmoji, false, memberChat ? memberChat.id : null);
            return;
        }

        // 从表情列表中随机选择一个
        const randomEmoji = emotionList[Math.floor(Math.random() * emotionList.length)];
        console.log(`根据情绪标签 ${emotionTag} 发送表情: ${randomEmoji}`);

        // 添加到群聊（使用群聊ID）
        this.addMessage(groupChatId, randomEmoji, false, memberChat ? memberChat.id : null);
    }

    /**
     * 关闭回溯模态框
     */
    closeReplyBackModal() {
        const modal = document.getElementById('reply-back-modal');
        if (modal) {
            modal.classList.remove('active');
        }
        // 重置选中状态
        this.selectedReplyBackMessageId = null;
        document.getElementById('confirm-reply-back-btn').disabled = true;
    }

    /**
     * 清空聊天记录
     */
    handleClearMessages() {
        if (!this.currentChat) return;

        const modal = document.getElementById('confirm-modal');
        const modalTitle = document.getElementById('confirm-modal-title');
        const modalMessage = document.getElementById('confirm-modal-message');
        const confirmBtn = document.getElementById('confirm-confirm-btn');
        const cancelBtn = document.getElementById('confirm-cancel-btn');

        if (!modal || !modalTitle || !modalMessage) {
            // 如果模态框不存在，直接确认
            if (confirm(`确定要清空 ${this.currentChat.name} 的所有聊天记录吗？`)) {
                this.clearChatMessages();
            }
            return;
        }

        modalTitle.textContent = '清空聊天记录';
        modalMessage.textContent = `确定要清空 ${this.currentChat.name} 的所有聊天记录吗？`;

        const showModal = () => {
            modal.classList.add('active');
            confirmBtn.onclick = () => {
                this.clearChatMessages();
                modal.classList.remove('active');
            };
            cancelBtn.onclick = () => {
                modal.classList.remove('active');
            };
        };

        // 如果模态框已经显示，先隐藏再显示
        if (modal.classList.contains('active')) {
            modal.classList.remove('active');
            setTimeout(showModal, 300);
        } else {
            showModal();
        }
    }

    /**
     * 清空聊天消息（实际执行）
     */
    clearChatMessages() {
        if (!this.currentChat) return;

        const chatId = this.currentChat.id;
        const chat = this.getChat(chatId);
        if (!chat) return;

        // 清空消息
        chat.messages = [];

        // 更新本地存储
        this.saveChats();

        // 重新渲染消息列表
        if (this.currentChat && this.currentChat.id === chatId) {
            this.renderMessages(chat);
            this.scrollToBottom(); // 确保滚动到最新消息位置
        }

        // 更新聊天列表
        this.renderChatList();

        console.log(`已清空聊天 ${chat.name} 的所有消息`);
    }

    /**
     * 生成新内容
     */
    handleGenerateNewContent() {
        if (!this.currentChat) return;

        const chat = this.currentChat;

        // 如果是群聊，需要选择成员
        if (chat.isGroup && chat.memberIds && chat.memberIds.length > 0) {
            this.showMemberSelectionForGenerate(chat);
        } else {
            // 单聊直接生成
            this.generateNewMessageForChat(chat.id);
        }
    }

    /**
     * 显示群成员选择（用于生成新内容）
     */
    showMemberSelectionForGenerate(chat) {
        const modal = document.getElementById('select-member-modal');
        if (!modal) return;

        // 渲染成员列表
        this.renderMemberList(chat);

        // 显示模态框
        modal.classList.add('active');

        // 确认按钮事件
        const confirmBtn = document.getElementById('select-member-confirm');
        const cancelBtn = document.getElementById('select-member-cancel');

        confirmBtn.onclick = () => {
            const selectedMemberId = this.getSelectedMemberId();
            if (selectedMemberId) {
                this.generateNewMessageForChat(chat.id, selectedMemberId);
                modal.classList.remove('active');
            } else {
                this.showNotification('请选择一个成员');
            }
        };

        cancelBtn.onclick = () => {
            modal.classList.remove('active');
        };
    }

    /**
     * 生成新消息
     */
    async generateNewMessageForChat(chatId, memberId = null) {
        const chat = this.getChat(chatId);
        if (!chat) return;

        // 显示等待消息
        const waitingMessageId = this.addWaitingMessage(chatId, memberId);

        try {
            let message = '';

            if (chat.isGroup && memberId) {
                // 群聊中生成指定成员的消息
                const member = this.getChat(memberId);
                if (member) {
                    message = await this.callAI(chatId, '请主动说一句话', member);
                }
            } else {
                // 单聊或群聊中生成当前聊天对象的消息
                message = await this.callAI(chatId, '请主动说一句话');
            }

            if (message) {
                // 解析情绪标签
                // 清理情绪标签
                let cleanMessage = message.replace(/\[emotion:\w+\]/g, '').trim();
                // 解析情绪标签并发送表情
                let emotionTag = null;
                const emotionMatch = message.match(/\[emotion:(\w+)\]/);
                if (emotionMatch) {
                    emotionTag = emotionMatch[1];
                    // 验证该分组是否存在于妈咪中心的表情设置中
                    if (this.mammySettings?.emotions && !this.mammySettings.emotions[emotionTag]) {
                        console.log(`情绪分组 "${emotionTag}" 不存在于表情库中，不发送表情`);
                        emotionTag = null;
                    }
                }

                // 添加清理后的消息到聊天
                this.addMessage(chatId, cleanMessage, false, memberId);

                // 发送表情消息
                if (emotionTag) {
                    setTimeout(() => {
                        this.sendEmotionByTag(chat, emotionTag);
                    }, 500);
                }

                // 更新未读计数（如果不在当前聊天窗口）
                if (!(this.currentChat && this.currentChat.id === chatId)) {
                    chat.unreadCount = (chat.unreadCount || 0) + 1;
                    this.renderChatList();
                }
            }
        } catch (error) {
            console.error('生成新消息失败:', error);
            this.addMessage(chatId, '生成消息失败，请重试', false);
        } finally {
            // 移除等待消息
            this.removeWaitingMessage(waitingMessageId);
        }
    }

    /**
     * 转账功能
     */
    handleTransferMoney() {
        if (!this.currentChat) return;

        const chat = this.currentChat;

        // 创建转账模态框
        this.createTransferModal(chat);
    }

    /**
     * 创建转账模态框
     */
    createTransferModal(chat) {
        let modal = document.getElementById('transfer-modal');
        if (!modal) {
            // 创建模态框
            modal = document.createElement('div');
            modal.id = 'transfer-modal';
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>转账</h3>
                        <button class="close-btn" onclick="this.closest('.modal').classList.remove('active')">✖️</button>
                    </div>
                    <div class="modal-body">
                        <div class="form-group">
                            <label for="transfer-amount">转账金额（元）</label>
                            <input type="number" id="transfer-amount" class="form-control" placeholder="请输入整数金额" min="1" max="999999">
                        </div>
                        ${chat.isGroup && chat.memberIds && chat.memberIds.length > 0 ? `
                        <div class="form-group">
                            <label for="transfer-target">转账对象</label>
                            <select id="transfer-target" class="form-control">
                                ${chat.memberIds.map(memberId => {
                                    const member = this.getChat(memberId);
                                    return `<option value="${memberId}">${member ? member.name : memberId}</option>`;
                                }).join('')}
                            </select>
                        </div>
                        ` : ''}
                    </div>
                    <div class="modal-footer">
                        <button class="cancel-btn" onclick="this.closest('.modal').classList.remove('active')">取消</button>
                        <button class="submit-btn" id="transfer-confirm-btn">确认转账</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        // 显示模态框
        modal.classList.add('active');

        // 确认按钮事件
        const confirmBtn = document.getElementById('transfer-confirm-btn');
        confirmBtn.onclick = () => {
            const amount = parseInt(document.getElementById('transfer-amount').value);
            const targetId = chat.isGroup ? document.getElementById('transfer-target').value : chat.id;

            if (!amount || amount <= 0) {
                this.showNotification('请输入有效的转账金额');
                return;
            }

            this.processTransfer(chat, amount, targetId);
            modal.classList.remove('active');
        };
    }

    /**
     * 标记转账消息为已接收
     */
    markTransferAsReceived(chatId) {
        const chat = this.getChat(chatId);
        if (!chat) return;
        // 找到最近的一条未接收的转账消息
        const transferMsg = chat.messages
            .slice()
            .reverse()
            .find(m => m.isTransfer && !m.received);
        if (transferMsg) {
            transferMsg.received = true;
            this.saveChats();
            // 如果当前正在查看该聊天，重新渲染
            if (this.currentChat && this.currentChat.id === chatId) {
                this.renderMessages(chat);
            }
        }
    }

    /**
     * 标记转账消息为已退回
     */
    markTransferAsRefunded(chatId) {
        const chat = this.getChat(chatId);
        if (!chat) return;
        // 找到最近的一条未退款的转账消息
        const transferMsg = chat.messages
            .slice()
            .reverse()
            .find(m => m.isTransfer && !m.refunded);
        if (transferMsg) {
            transferMsg.refunded = true;
            this.saveChats();
            // 如果当前正在查看该聊天，重新渲染
            if (this.currentChat && this.currentChat.id === chatId) {
                this.renderMessages(chat);
            }
        }
    }

    /**
     * 处理转账
     */
    async processTransfer(chat, amount, targetId) {
        const target = this.getChat(targetId);
        if (!target) return;
        const transferMessage = `💰 妈咪向 ${target.name} 转账 ${amount} 元`;
        this.addTransferMessage(chat.id, transferMessage, amount, targetId);
        this.saveChats();   // 保存消息
        if (!(this.currentChat && this.currentChat.id === chat.id)) {
            chat.unreadCount = (chat.unreadCount || 0) + 1;
            this.renderChatList();
        }
        // 触发AI回复
        try {
            const reply = await this.callAI(chat.id, `妈咪给你转账了${amount}元。请根据你的角色性格回复一条消息（感谢、调侃、拒绝等），并在消息末尾加上行动标签，格式为 [action:accept] 或 [action:refuse]，例如：谢谢妈咪！[action:accept] 或 我才不要你的钱！[action:refuse]`, target);
            if (reply) {
                // 解析行动标签
                let action = 'accept'; // 默认接收
                let cleanReply = reply;
                const actionMatch = reply.match(/\[action:(accept|refuse)\]/);
                if (actionMatch) {
                    action = actionMatch[1];
                    cleanReply = reply.replace(/\[action:(accept|refuse)\]/, '').trim();
                }

                // 使用统一的消息添加方法，自动剥离情绪标签并发送表情
                this.addMessageWithEmotion(chat.id, cleanReply, false, targetId);

                // 根据行动标签执行相应逻辑
                if (action === 'accept') {
                    // 延迟标记转账为已接收，并发送接收卡片
                    setTimeout(() => {
                        // 标记妈咪的转账消息为已接收
                        this.markTransferAsReceived(chat.id);

                        // 发送角色侧的"已接收"卡片
                        const receivedCard = {
                            id: Date.now() + Math.random(),
                            text: `已接收 ¥${amount}`,
                            time: this.getRelativeTime(new Date()),
                            isMe: false,
                            type: 'transfer_received_card',
                            transferAmount: amount,
                            timestamp: new Date().toISOString()
                        };
                        chat.messages.push(receivedCard);
                        this.saveChats();
                        if (this.currentChat && this.currentChat.id === chat.id) {
                            this.renderMessages(this.currentChat);
                            this.scrollToBottom();
                        }
                    }, 3000);
                } else if (action === 'refuse') {
                    setTimeout(() => {
                        this.markTransferAsRefunded(chat.id);
                        const refundedCard = {
                            id: Date.now() + Math.random(),
                            text: `已退回 ¥${amount}`,
                            time: this.getRelativeTime(new Date()),
                            isMe: false,
                            type: 'transfer_refunded_card',
                            transferAmount: amount,
                            timestamp: new Date().toISOString()
                        };
                        chat.messages.push(refundedCard);
                        this.saveChats();
                        if (this.currentChat && this.currentChat.id === chat.id) {
                            this.renderMessages(this.currentChat);
                            this.scrollToBottom();
                        }
                    }, 3000);
                }
            } else {
                // AI回复为空时，默认执行接收逻辑
                setTimeout(() => {
                    this.markTransferAsReceived(chat.id);
                }, 3000);
            }
        } catch (error) {
            console.error('AI回复失败:', error);
            this.addMessage(chat.id, '收到转账，谢谢妈咪！', false);
            // 失败时，默认执行接收逻辑
            setTimeout(() => {
                this.markTransferAsReceived(chat.id);
            }, 3000);
        }
    }  // processTransfer 方法的正确结束括号

    /**
     * 处理红包功能
     */
    handleRedPacket() {
        if (!this.currentChat || !this.currentChat.isGroup) return;
        this.showRedPacketModal();
    }

    /**
     * 显示红包设置模态框
     */
    showRedPacketModal() {
        const chat = this.currentChat;
        let modal = document.getElementById('redpacket-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'redpacket-modal';
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>🧧 发红包</h3>
                        <button class="close-btn" onclick="this.closest('.modal').classList.remove('active')">✖️</button>
                    </div>
                    <div class="modal-body">
                        <div class="form-group">
                            <label for="redpacket-total-amount">总金额（元）</label>
                            <input type="number" id="redpacket-total-amount" class="form-control" placeholder="请输入整数金额" min="1" max="9999">
                        </div>
                        <div class="form-group">
                            <label for="redpacket-count">红包个数</label>
                            <input type="number" id="redpacket-count" class="form-control" placeholder="请输入红包数量" min="1" max="100">
                        </div>
                        <div class="form-group">
                            <label for="redpacket-type">红包类型</label>
                            <select id="redpacket-type" class="form-control">
                                <option value="normal">普通红包</option>
                                <option value="lucky">拼手气红包</option>
                                <option value="exclusive">专属红包</option>
                            </select>
                        </div>
                        <div class="form-group" id="redpacket-target-group" style="display: none;">
                            <label for="redpacket-target">领取对象</label>
                            <select id="redpacket-target" class="form-control">
                                ${chat.members && chat.members.map(memberId => {
    const memberChat = this.getChat(memberId);
    return `<option value="${memberId}">${memberChat ? memberChat.name : memberId}</option>`;
}).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="redpacket-message">祝福语</label>
                            <input type="text" id="redpacket-message" class="form-control" placeholder="恭喜发财，大吉大利！">
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="cancel-btn" onclick="this.closest('.modal').classList.remove('active')">取消</button>
                        <button class="submit-btn" id="redpacket-send-btn">发送红包</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            // 绑定红包类型选择事件
            const typeSelect = document.getElementById('redpacket-type');
            const targetGroup = document.getElementById('redpacket-target-group');
            typeSelect.onchange = (e) => {
                if (e.target.value === 'exclusive') {
                    targetGroup.style.display = 'block';
                } else {
                    targetGroup.style.display = 'none';
                }
            };
        }

        // 显示模态框
        modal.classList.add('active');

        // 发送按钮事件
        const sendBtn = document.getElementById('redpacket-send-btn');
        sendBtn.onclick = () => {
            const totalAmount = parseInt(document.getElementById('redpacket-total-amount').value);
            const count = parseInt(document.getElementById('redpacket-count').value);
            const type = document.getElementById('redpacket-type').value;
            const message = document.getElementById('redpacket-message').value;
            const targetMemberId = type === 'exclusive' ? document.getElementById('redpacket-target').value : null;

            if (!totalAmount || totalAmount <= 0) {
                this.showNotification('请输入有效的红包金额');
                return;
            }
            if (!count || count <= 0) {
                this.showNotification('请输入有效的红包数量');
                return;
            }
            if (type === 'exclusive' && !targetMemberId) {
                this.showNotification('请选择领取对象');
                return;
            }

            this.sendRedPacket(type, totalAmount, count, type === 'lucky', message, targetMemberId);
            modal.classList.remove('active');
        };
    }

    /**
     * 发送红包
     */
    sendRedPacket(type, totalAmount, count, isLucky, message, targetMemberId) {
        if (!this.currentChat || !this.currentChat.isGroup) return;

        const chat = this.currentChat;
        const redPacketId = Date.now() + Math.random();
        const remainingAmount = totalAmount;
        const remainingCount = count;
        const grabbedUsers = [];
        const amounts = [];

        // 生成红包金额分配
        if (isLucky && count > 1) {
            // 拼手气红包：随机分配金额
            let remainingAmount = totalAmount;
            for (let i = 0; i < count - 1; i++) {
                // 保证每次分配后剩余金额足够后续每人至少 1 元
                const maxSingle = remainingAmount - (count - i - 1);
                // 随机金额范围 0.01 到 maxSingle，单位为分，最后再转回元
                const maxSingleCents = maxSingle * 100;
                const randomCents = Math.floor(Math.random() * maxSingleCents) + 1;
                const amount = randomCents / 100;
                amounts.push(amount);
                remainingAmount -= amount;
            }
            amounts.push(remainingAmount);
            // 打乱顺序
            for (let i = amounts.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [amounts[i], amounts[j]] = [amounts[j], amounts[i]];
            }
        } else {
            // 普通红包：平均分配
            const amount = Math.floor(totalAmount / count * 100) / 100; // 保留两位小数
            let sum = 0;
            for (let i = 0; i < count - 1; i++) {
                amounts.push(amount);
                sum += amount;
            }
            amounts.push(Math.round((totalAmount - sum) * 100) / 100);
        }

        const redPacketMessage = {
            id: redPacketId,
            text: `🧧 ${message || '恭喜发财，大吉大利！'}`,
            time: this.getRelativeTime(new Date()),
            isMe: true,
            type: 'redpacket',
            redPacket: {
                id: redPacketId,
                type: type,
                totalAmount: totalAmount,
                remainingAmount: remainingAmount,
                totalCount: count,
                remainingCount: remainingCount,
                isLucky: isLucky,
                message: message || '恭喜发财，大吉大利！',
                targetMemberId: targetMemberId,
                grabbedUsers: grabbedUsers,
                amounts: amounts,
                timestamp: new Date().toISOString()
            },
            timestamp: new Date().toISOString()
        };

        chat.messages.push(redPacketMessage);
        this.saveChats();
        this.renderMessages(chat);
        this.scrollToBottom();

        console.log('红包已发送:', redPacketMessage);

        // 触发群成员自动抢红包
        setTimeout(() => {
            this.triggerMembersGrabRedPacket(chat.id, redPacketMessage.id);
        }, 2000); // 延迟2秒开始抢，让用户看到红包发出
    }

    /**
     * 群成员发红包（指定发送者）
     */
    sendRedPacketAsMember(chatId, senderId, type, totalAmount, count, message, targetMemberId = null) {
        const chat = this.getChat(chatId);
        if (!chat || !chat.isGroup) return;

        const redPacketId = Date.now() + Math.random();
        const amounts = this.generateRedPacketAmounts(type, totalAmount, count);

        const redPacketMessage = {
            id: redPacketId,
            text: `🧧 ${message || '恭喜发财，大吉大利！'}`,
            time: this.getRelativeTime(new Date()),
            isMe: false,
            senderId: senderId,
            type: 'redpacket',
            redPacket: {
                id: redPacketId,
                type: type,
                totalAmount: totalAmount,
                totalCount: count,
                remainingCount: count,
                isLucky: type === 'lucky',
                message: message || '恭喜发财，大吉大利！',
                grabbedUsers: [],
                amounts: amounts,
                senderId: senderId, // ✅ 必须添加
                targetMemberId: targetMemberId || null // 专属红包目标成员
            },
            timestamp: new Date().toISOString()
        };

        chat.messages.push(redPacketMessage);
        chat.lastMessage = redPacketMessage.text;
        chat.lastTimestamp = redPacketMessage.timestamp;
        this.saveChats();
        this.renderMessages(chat);
        this.scrollToBottom();

        // 触发群成员自动抢红包（延迟 2 秒）
        setTimeout(() => {
            this.triggerMembersGrabRedPacket(chat.id, redPacketMessage.id);
        }, 2000);

        // 红包发出后立即触发一次讨论（延迟 1 秒）
        setTimeout(() => {
            const eventDesc = this.buildRedPacketSummary(chat, redPacketMessage);
            if (eventDesc) this.triggerGroupEventDiscussion(chatId, eventDesc);
        }, 1000);
    }

    /**
     * 根据红包类型生成金额数组
     */
    generateRedPacketAmounts(type, totalAmount, count) {
        const amounts = [];
        if (type === 'lucky' && count > 1) {
            let remaining = totalAmount;
            for (let i = 0; i < count - 1; i++) {
                const max = remaining - (count - i - 1) * 0.01;
                const amount = Math.random() * max;
                const rounded = Math.round(amount * 100) / 100;
                amounts.push(rounded);
                remaining -= rounded;
            }
            amounts.push(Math.round(remaining * 100) / 100);
            // 打乱顺序
            for (let i = amounts.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [amounts[i], amounts[j]] = [amounts[j], amounts[i]];
            }
        } else {
            const avg = totalAmount / count;
            let sum = 0;
            for (let i = 0; i < count - 1; i++) {
                const amt = Math.floor(avg * 100) / 100;
                amounts.push(amt);
                sum += amt;
            }
            amounts.push(Math.round((totalAmount - sum) * 100) / 100);
        }
        return amounts;
    }

    /**
     * 抢红包（支持任意成员）
     */
    grabRedPacket(messageId, memberId = 'user_mummy') {
        const chat = this.currentChat;
        if (!chat || !chat.isGroup) return;

        const message = chat.messages.find(m => m.id === messageId && m.type === 'redpacket');
        if (!message || !message.redPacket) return;

        const redPacket = message.redPacket;

        // 检查是否已经抢过
        if (redPacket.grabbedUsers.includes(memberId)) {
            if (memberId === 'user_mummy') {
                this.showNotification('您已经抢过这个红包了');
            }
            return;
        }

        // 检查是否还有剩余
        if (redPacket.remainingCount <= 0) {
            if (memberId === 'user_mummy') {
                this.showNotification('红包已经被抢完了');
            }
            return;
        }

        // 检查专属红包权限
        if (redPacket.type === 'exclusive' && redPacket.targetMemberId !== memberId) {
            if (memberId === 'user_mummy') {
                this.showNotification('这个红包是专属红包，您没有领取权限');
            }
            return;
        }

        // 抢红包
        const amount = redPacket.amounts[redPacket.totalCount - redPacket.remainingCount];
        redPacket.grabbedUsers.push(memberId);
        redPacket.remainingCount--;
        redPacket.remainingAmount -= amount;

        // 只有妈咪手动抢才添加个人消息
        if (memberId === 'user_mummy') {
            const grabMessage = {
                id: Date.now() + Math.random(),
                text: `🎉 恭喜您抢到 ¥${amount}！`,
                time: this.getRelativeTime(new Date()),
                isMe: true,
                type: 'redpacket_grab',
                redPacketGrab: {
                    redPacketId: redPacket.id,
                    amount: amount,
                    remainingAmount: redPacket.remainingAmount,
                    remainingCount: redPacket.remainingCount
                },
                timestamp: new Date().toISOString()
            };

            chat.messages.push(grabMessage);
            chat.lastMessage = grabMessage.text;
            chat.lastTimestamp = grabMessage.timestamp;
            this.showNotification(`恭喜您抢到 ¥${amount}！`);
        }

        this.saveChats();
        this.renderMessages(chat);
        this.scrollToBottom();

        // 检查红包是否被抢完
        const updatedMsg = chat.messages.find(m => m.id === messageId);
        if (updatedMsg && updatedMsg.redPacket && updatedMsg.redPacket.remainingCount === 0) {
            const eventDesc = this.buildRedPacketSummary(chat, updatedMsg);
            this.triggerGroupEventDiscussion(chat.id, eventDesc);

            // 8秒后再推一把，防止第一轮冷场
            setTimeout(() => {
                const stillActive = this.getChat(chat.id);
                if (stillActive && stillActive.isGroup) {
                    const followUpTrigger = `（大家还在聊刚才的红包吗？）`;
                    this.triggerGroupReplies(chat.id, followUpTrigger);
                }
            }, 8000);
        }

        console.log('红包已领取:', { amount, remaining: redPacket.remainingCount });
    }

    /**
     * 调用AI生成群成员回复（辅助方法）
     * @param {string} chatId 群聊ID
     * @param {string} memberId 成员ID
     * @param {string} prompt 提示词
     */
    async callAIForMemberReply(chatId, memberId, prompt) {
        const memberChat = this.getChat(memberId);
        if (!memberChat) return;
        const systemPrompt = this.getMemberContextPrompt(memberId, chatId);
        const reply = await this.callAIDirect(systemPrompt, prompt, memberChat.replyTemp || 0.5);
        if (reply) {
            await this.addMessageWithEmotion(chatId, reply, false, memberId);
        }
    }

    /**
     * 触发群成员自动抢红包
     * @param {string} chatId 群聊ID
     * @param {number} messageId 红包消息的ID
     */
    async triggerMembersGrabRedPacket(chatId, messageId) {
        const chat = this.getChat(chatId);
        if (!chat || !chat.isGroup) return;

        const message = chat.messages.find(m => m.id === messageId && m.type === 'redpacket');
        if (!message || !message.redPacket) return;

        const redPacket = message.redPacket;

        // 获取可抢红包的成员列表
        let eligibleMembers = this.getAvailableGroupMembers(chat);

        // 过滤掉妈咪（妈咪手动抢）和发送者（自己发的红包自己不能抢）
        eligibleMembers = eligibleMembers.filter(id => id !== 'user_mummy' && id !== redPacket.senderId);

        // 专属红包检查：如果不是目标成员，则不能抢
        if (redPacket.type === 'exclusive' && redPacket.targetMemberId) {
            eligibleMembers = eligibleMembers.filter(id => id === redPacket.targetMemberId);
        }

        if (eligibleMembers.length === 0) return;

        // 随机打乱顺序，模拟真实抢红包的竞争感
        const shuffledMembers = [...eligibleMembers].sort(() => Math.random() - 0.5);

        // 逐个成员尝试抢红包，每次抢之间加入随机延迟（1-4秒）
        for (const memberId of shuffledMembers) {
            // 每次抢之前，重新获取最新的消息和红包数据，防止状态过期
            const currentMsg = chat.messages.find(m => m.id === messageId);
            if (!currentMsg || !currentMsg.redPacket) break;
            const currentPacket = currentMsg.redPacket;

            // 检查红包是否还有剩余
            if (currentPacket.remainingCount <= 0) {
                console.log('红包已抢完，停止自动抢');
                break;
            }

            // 检查该成员是否已抢过
            if (currentPacket.grabbedUsers.includes(memberId)) continue;

            // 随机延迟
            const delay = Math.floor(Math.random() * 3000) + 1000; // 1000-4000ms
            await new Promise(resolve => setTimeout(resolve, delay));

            // 再次获取最新状态（因为延迟期间妈咪可能手动抢了）
            const latestMsg = chat.messages.find(m => m.id === messageId);
            if (!latestMsg || !latestMsg.redPacket) break;
            const latestPacket = latestMsg.redPacket;

            if (latestPacket.remainingCount <= 0) break;
            if (latestPacket.grabbedUsers.includes(memberId)) continue;

            // 执行抢红包逻辑 - 直接更新红包数据（不调用 grabRedPacket 避免重复消息）
            const amount = latestPacket.amounts[latestPacket.totalCount - latestPacket.remainingCount];
            latestPacket.grabbedUsers.push(memberId);
            latestPacket.remainingCount--;
            latestPacket.remainingAmount = Math.max(0, (latestPacket.remainingAmount * 100 - amount * 100) / 100);

            // 生成系统消息：🧧 角色名 抢到了 X 元！
            const memberInfo = this.getMemberDisplayInfo(memberId);

            const sysMsg = {
                id: Date.now() + Math.random(),
                text: `🧧 ${memberInfo.name} 抢到了 ${amount.toFixed(2)} 元！`,
                timestamp: new Date().toISOString(),
                isSystem: true
            };
            chat.messages.push(sysMsg);

            // 更新最后消息
            chat.lastMessage = sysMsg.text;
            chat.lastTimestamp = sysMsg.timestamp;

            // 渲染聊天界面
            if (this.currentChat && this.currentChat.id === chatId) {
                this.renderMessages(chat);
                this.scrollToBottom();
            }

            // 触发该角色抢红包后的发言
            this.triggerMemberReplyAfterGrab(chatId, memberId, amount, latestPacket.type, latestPacket);
        }

        // 循环结束后，检查红包是否被抢完，如果抢完则更新 UI 并临时提升对话设置
        const finalMsg = chat.messages.find(m => m.id === messageId);
        if (finalMsg && finalMsg.redPacket && finalMsg.redPacket.remainingCount === 0) {
            console.log('红包已抢完');

            // 【关键修改1】临时提升对话深度和回复速度，让讨论更热烈
            const originalDepth = chat.maxConversationDepth;
            const originalSpeed = chat.replySpeedFactor;
            chat.maxConversationDepth = Math.max(originalDepth || 4, 10); // 临时提升到至少10轮
            chat.replySpeedFactor = 0.3; // 回复间隔更短，更像真实讨论

            // 【关键修改2】12秒后恢复原始设置
            setTimeout(() => {
                const currentChat = this.getChat(chatId);
                if (currentChat) {
                    currentChat.maxConversationDepth = originalDepth;
                    currentChat.replySpeedFactor = originalSpeed;
                }
            }, 12000);

            // 【关键修改3】6秒后追加一个"拱火"消息，强制开启第二轮讨论
            setTimeout(() => {
                const stillActive = this.getChat(chatId);
                if (stillActive && stillActive.isGroup) {
                    const followUpTrigger = `（大家还在聊刚才的红包吗？运气王是不是该表示一下？手气差的也别闷着啊！）`;
                    this.triggerGroupReplies(chatId, followUpTrigger);
                }
            }, 6000);
        }
    }

    /**
     * 根据红包剩余数据计算本次抢到的金额
     * @param {Object} redPacket 红包对象
     * @returns {number|null} 抢到的金额，失败返回null
     */
    calculateRedPacketAmount(redPacket) {
        if (!redPacket || redPacket.remainingCount <= 0) return null;

        let amount;
        if (redPacket.isLucky) {
            // 拼手气红包：从预生成的 amounts 数组中按顺序取
            const grabbedIndex = redPacket.totalCount - redPacket.remainingCount;
            amount = redPacket.amounts[grabbedIndex];
        } else {
            // 普通红包：平均分配
            amount = redPacket.totalAmount / redPacket.totalCount;
        }
        return Math.round(amount * 100) / 100; // 保留两位小数
    }

    /**
     * 构建红包抢完后的详细事件描述
     * @param {Object} chat 群聊对象
     * @param {Object} redPacketMsg 红包消息对象
     * @returns {string} 事件描述文本
     */
    buildRedPacketSummary(chat, redPacketMsg) {
        const redPacket = redPacketMsg.redPacket;
        const senderId = redPacket.senderId || redPacketMsg.senderId;
        const senderInfo = this.getMemberDisplayInfo(senderId);
        const senderName = senderInfo.name || '未知';
        const typeText = redPacket.type === 'lucky' ? '拼手气红包' : (redPacket.type === 'exclusive' ? '专属红包' : '普通红包');

        // 收集抢红包结果
        const grabResults = [];
        if (redPacket.grabbedUsers && redPacket.grabbedUsers.length > 0) {
            redPacket.grabbedUsers.forEach(memberId => {
                if (!memberId) return;
                const info = this.getMemberDisplayInfo(memberId);
                if (!info || !info.name) return;
                const amount = this.calculateRedPacketAmountForUser(redPacket, memberId) || 0;
                grabResults.push({ id: memberId, name: info.name, amount: amount });
            });
        }

        // 获取红包类型描述
        let typeDesc = '';
        if (redPacket.type === 'lucky') {
            typeDesc = `拼手气红包，总金额 ${redPacket.totalAmount} 元，运气有好坏！`;
        } else if (redPacket.type === 'exclusive') {
            typeDesc = `专属红包，总金额 ${redPacket.totalAmount} 元，只有指定成员能抢！`;
        } else {
            typeDesc = `普通红包，总金额 ${redPacket.totalAmount} 元，每人金额固定。`;
        }

        let summary = `${senderName} 发了一个${typeText}，${typeDesc}`;

        // 根据红包类型构建个性化讨论要求
        if (redPacket.type === 'lucky') {
            summary += `\n\n【红包结果出来了，大家开始七嘴八舌地讨论起来】`;
            summary += `\n抢红包结果：`;
            if (grabResults.length > 0) {
                grabResults.forEach(r => {
                    summary += `\n- ${r.name} 抢到了 ${r.amount.toFixed(2)} 元`;
                });
            } else {
                summary += `\n暂无人抢红包，大家快抢啊！`;
            }

            if (grabResults.length > 0) {
                // 按金额排序
                const sorted = [...grabResults].sort((a, b) => b.amount - a.amount);
                const luckyKing = sorted[0];
                const poorGuy = sorted[sorted.length-1];

                summary += `\n\n${luckyKing.name} 是运气王，独揽 ${luckyKing.amount.toFixed(2)} 元！`;
                summary += `\n${poorGuy.name} 手气最差，只有 ${poorGuy.amount.toFixed(2)} 元。`;

                // 针对运气王和手气差的人的个性化要求
                summary += `\n**请根据具体金额发表个性化看法，不要重复他人的话：**`;
                summary += `\n- ${luckyKing.name}：金额较多要炫耀、感谢，或调侃其他成员。`;
                summary += `\n- ${poorGuy.name}：金额很少要强烈吐槽、质疑红包真实性，或用"就这？""不是吧"等语气词。`;
                summary += `\n- 其他成员：根据自己抢到的金额发表不同反应，金额少要抱怨，金额适中要调侃，金额多要炫耀。`;
            } else {
                summary += `\n\n**大家快来抢红包，讨论一下手气！**`;
            }
            summary += `\n- 语气要符合角色性格，讨论要热烈，至少进行3-4轮互动！`;

        } else if (redPacket.type === 'exclusive') {
            let targetInfo = null;
            if (redPacket.targetMemberId) {
                targetInfo = this.getMemberDisplayInfo(redPacket.targetMemberId);
            }
            summary += `\n\n【专属红包】`;
            summary += `\n【发送者】${senderName}`;
            if (targetInfo) {
                summary += `\n【接收者】${targetInfo.name}`;
            } else {
                summary += `\n【接收者】未知`;
            }

            if (grabResults.length > 0) {
                const receiver = grabResults[0];
                summary += `\n${receiver.name} 已领取，金额 ${receiver.amount.toFixed(2)} 元！`;
            } else {
                const receiverName = targetInfo ? targetInfo.name : '指定成员';
                summary += `\n红包尚未被领取，等待 ${receiverName} 点击...`;
            }
            summary += `\n\n**请根据以下要求发表看法：**`;
            if (grabResults.length > 0) {
                const receiver = grabResults[0];
                summary += `\n- ${receiver.name}：感谢 ${senderName}，或害羞/得意地回应。`;
                summary += `\n- 其他成员：表达羡慕、嫉妒，或开玩笑问"有情况啊？""为什么只给TA？"`;
            } else {
                const receiverName = targetInfo ? targetInfo.name : '指定成员';
                summary += `\n- 其他成员：催促 ${receiverName} 快点领取，或开玩笑问"有情况啊？""为什么只给TA？"`;
            }
            summary += `\n- 【重要】如果你是发送者，不要以旁观者口吻评论自己的红包；如果你是接收者，应表达感谢或害羞。`;
            summary += `\n- 语气要符合角色关系，讨论要自然，至少进行3-4轮互动！`;

        } else {
            summary += `\n\n【普通红包结果】`;
            summary += `\n抢红包结果：`;
            if (grabResults.length > 0) {
                grabResults.forEach(r => {
                    summary += `\n- ${r.name} 抢到了 ${r.amount.toFixed(2)} 元`;
                });
            } else {
                summary += `\n暂无人抢红包，大家快抢啊！`;
            }
            summary += `\n\n**请根据具体金额发表个性化看法，不要重复他人的话：**`;
            summary += `\n- 感谢 ${senderName} 的慷慨，或调侃抢红包的手速。`;
            summary += `\n- 如果有人没抢到，要抱怨手慢或网络问题。`;
            summary += `\n- 根据角色性格发表不同反应，避免雷同，至少进行3-4轮互动！`;
        }

        return summary;
    }

    /**
     * 计算指定用户抢到的金额（辅助方法）
     * @param {Object} redPacket 红包对象
     * @param {string} memberId 成员ID
     * @returns {number} 金额
     */
    calculateRedPacketAmountForUser(redPacket, memberId) {
        const index = redPacket.grabbedUsers.indexOf(memberId);
        if (index === -1) return 0;
        // 对于普通红包，确保返回正确的固定金额
        if (redPacket.type === 'normal' && redPacket.amounts[index] === undefined) {
            return redPacket.totalAmount / redPacket.totalCount;
        }
        return redPacket.amounts[index] || 0;
    }

    /**
     * 触发角色抢到红包后的发言
     * @param {string} chatId 群聊ID
     * @param {string} memberId 成员ID
     * @param {number} amount 抢到的金额
     * @param {string} redPacketType 红包类型
     * @param {Object} redPacket 红包对象（包含发送者信息）
     */
    async triggerMemberReplyAfterGrab(chatId, memberId, amount, redPacketType, redPacket) {
        const memberChat = this.getChat(memberId);
        if (!memberChat) return;

        // 获取发红包者名称
        const senderInfo = this.getMemberDisplayInfo(redPacket.senderId);
        const senderName = senderInfo.name;

        const isSelf = (memberId === redPacket.senderId);
        let prompt = `你是${memberChat.name}。`;
        prompt += `\n你在群聊里抢到了 ${senderName} 发的红包，金额是 ${amount.toFixed(2)} 元。`;

        if (redPacketType === 'exclusive') {
            prompt += ` 这是一个专属红包，只有你能抢。`;
        } else if (redPacketType === 'lucky') {
            prompt += ` 这是一个拼手气红包，总金额 ${redPacket.totalAmount} 元。`;
        } else {
            prompt += ` 这是一个普通红包，总金额 ${redPacket.totalAmount} 元，每人抢到的金额相同。`;
        }

        prompt += `\n请根据你的性格（${memberChat.personalityPrompt || '未知'}）和抢到的金额，说一句简短的话（1-15字）。`;
        prompt += `\n【重要规则】`;
        prompt += `\n- 你必须清楚自己是抢红包的人，${senderName} 是发红包的人。`;
        prompt += `\n- 如果你抢到的金额很少，可以吐槽发红包者小气，或者自嘲运气差。`;
        prompt += `\n- 如果你抢到的金额很多，可以感谢、炫耀，或调侃发红包者。`;
        if (isSelf) {
            prompt += `\n- 注意：这个红包是你自己发的！你应该表现出得意、自嘲手气差、或调侃别人抢得少，但绝不能感谢或羡慕自己。`;
        }
        prompt += `\n- 禁止说"谢谢老板"之类的泛泛之词，要体现你的个性和对具体金额的反应。`;
        prompt += `\n只输出说话内容，不要引号。`;

        try {
            const reply = await this.callAIDirect(
                this.getMemberContextPrompt(memberId, chatId),
                prompt,
                memberChat.replyTemp || 0.5
            );
            if (reply && reply.trim()) {
                await this.addMessageWithEmotion(chatId, reply, false, memberId);
            }
        } catch (error) {
            console.error(`角色 ${memberChat.name} 抢红包后发言失败`, error);
        }
    }

    /**
     * 触发角色禁言到期后的发言
     * @param {string} chatId 群聊ID
     * @param {string} memberId 成员ID
     */
    async triggerMemberReplyAfterUnmute(chatId, memberId) {
        const chat = this.getChat(chatId);
        if (!chat || !chat.isGroup) return;
        const memberChat = this.getChat(memberId) || this.findNPCData(memberId);
        if (!memberChat) return;

        // 构建提示词：禁言结束，出来说句话
        const systemPrompt = this.getMemberContextPrompt(memberId, chatId);
        const userPrompt = `（系统提示：你的禁言刚刚到期解除了。请根据你的性格，第一时间说一句话。可以抱怨、吐槽禁言者、表示反省、或者假装无事发生。）`;

        try {
            const reply = await this.callAIDirect(systemPrompt, userPrompt, 0.7);
            if (reply) {
                await this.addMessageWithEmotion(chatId, reply, false, memberId);

                // 新增：触发群成员讨论（延迟 2 秒，让被禁言者的消息先显示）
                setTimeout(() => {
                    const memberName = this.getMemberDisplayInfo(memberId).name;
                    const eventDesc = `${memberName} 的禁言到期了，终于可以说话了！`;
                    this.triggerGroupEventDiscussion(chatId, eventDesc);
                }, 2000);
            }
        } catch (e) {
            console.error('禁言到期自动发言失败', e);
        }
    }

    /**
     * 处理群聊心声功能
     */
    handleGroupVoice() {
        const chat = this.currentChat;
        if (!chat || !chat.isGroup) return;
        const members = chat.members || [];
        if (members.length === 0) {
            this.showNotification('群内暂无成员');
            return;
        }
        this.showSelectVoiceMemberModal(members);
    }

    /**
     * 显示选择心声对象的模态框
     */
    showSelectVoiceMemberModal(members) {
        const modal = document.getElementById('select-voice-member-modal');
        if (!modal) return;

        const container = document.getElementById('voice-member-list');
        if (!container) return;

        // 渲染成员列表
        container.innerHTML = members.map(memberId => {
            const memberInfo = this.getMemberDisplayInfo(memberId);
            const memberName = memberInfo.name || memberId;
            const avatar = memberInfo.avatar || '👤';

            // 处理头像显示
            let avatarHtml;
            if (avatar && typeof avatar === 'string' && (avatar.startsWith('http://') || avatar.startsWith('https://'))) {
                avatarHtml = `<img src="${avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
            } else {
                avatarHtml = `<span>${avatar}</span>`;
            }

            return `
                <div class="member-item" data-member-id="${memberId}" style="display: flex; align-items: center; gap: 12px; padding: 12px; border-bottom: 1px solid var(--border); cursor: pointer;">
                    <div class="member-avatar" style="width: 40px; height: 40px; border-radius: 50%; background: var(--nav-active-bg); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        ${avatarHtml}
                    </div>
                    <span style="font-size: 16px; color: var(--text-primary);">${memberName}</span>
                </div>
            `;
        }).join('');

        // 绑定点击事件
        container.querySelectorAll('.member-item').forEach(item => {
            item.addEventListener('click', () => {
                const memberId = item.dataset.memberId;
                this.closeSelectVoiceMemberModal();
                this.showGroupVoiceModal(memberId);
            });
        });

        modal.classList.add('active');
    }

    /**
     * 关闭选择心声对象模态框
     */
    closeSelectVoiceMemberModal() {
        const modal = document.getElementById('select-voice-member-modal');
        if (modal) modal.classList.remove('active');
    }

    /**
     * 显示成员选择器
     */
    showMemberSelector(members, callback) {
        // 移除已存在的选择器
        const existingSelector = document.getElementById('member-selector-floating');
        if (existingSelector) {
            existingSelector.remove();
        }

        const selector = document.createElement('div');
        selector.id = 'member-selector-floating';
        selector.className = 'dynamic-popup-menu';
        selector.innerHTML = `
            <div style="padding: 12px;">
                <h4 style="margin-bottom: 12px; text-align: center;">选择心声对象</h4>
                <div style="max-height: 200px; overflow-y: auto;">
                    ${members.map(memberId => {
                        const memberInfo = this.getMemberDisplayInfo(memberId);
                        const memberName = memberInfo.name || memberId;
                        return `
                            <div class="popup-menu-item" data-member-id="${memberId}">
                                <div class="popup-menu-icon">👤</div>
                                <div class="popup-menu-text">${memberName}</div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
        document.body.appendChild(selector);

        // 定位在屏幕中央
        const rect = selector.getBoundingClientRect();
        selector.style.left = `calc(50% - ${rect.width / 2}px)`;
        selector.style.top = `calc(50% - ${rect.height / 2}px)`;

        // 绑定点击事件
        const items = selector.querySelectorAll('.popup-menu-item');
        items.forEach(item => {
            item.onclick = () => {
                const memberId = item.getAttribute('data-member-id');
                selector.remove();
                callback(memberId);
            };
        });

        // 点击外部关闭
        setTimeout(() => {
            document.addEventListener('click', function closeSelector(e) {
                if (!selector.contains(e.target)) {
                    selector.remove();
                    document.removeEventListener('click', closeSelector);
                }
            });
        }, 100);
    }

    /**
     * 为指定成员生成心声
     */
    async generateVoiceForMember(memberId) {
        const memberChat = this.getChat(memberId);
        if (!memberChat) {
            this.showNotification('找不到该成员');
            return;
        }

        // 显示加载状态
        const voiceModal = document.getElementById('voice-thoughts-modal');
        if (voiceModal) {
            voiceModal.classList.add('active');
            document.getElementById('voice-thoughts-content').innerHTML = `
                <div style="text-align: center;">
                    <div class="spinner" style="width: 30px; height: 30px;"></div>
                    <p style="margin-top: 15px; color: var(--text-secondary);">正在生成 ${memberChat.name} 的心声...</p>
                </div>
            `;
        }

        try {
            // 构建提示词
            const prompt = `请模拟${memberChat.name}的内心独白。基于以下设定：
- 角色性格：${memberChat.personality || '未知'}
- 当前场景：在群聊中
- 内心活动：表达真实想法、感受或观察

请生成一段第一人称的内心独白，风格要符合角色性格，内容可以是：
1. 对群聊话题的看法
2. 对某个事件的感受
3. 对群友行为的观察
4. 个人心情或想法

要求：简洁真实，不超过100字，用口语化表达，体现角色个性。`;

            const voiceThoughts = await this.callAI(memberId, prompt);
            if (voiceThoughts) {
                // 创建心声消息
                const message = {
                    id: Date.now() + Math.random(),
                    text: voiceThoughts,
                    time: this.getRelativeTime(new Date()),
                    isMe: false,
                    type: 'voice_thoughts',
                    voiceThoughts: {
                        memberId: memberId,
                        memberName: memberChat.name
                    },
                    timestamp: new Date().toISOString()
                };

                // 添加到当前群聊
                if (this.currentChat) {
                    this.currentChat.messages.push(message);
                    this.saveChats();
                    this.renderMessages(this.currentChat);
                    this.scrollToBottom();
                }

                // 关闭模态框
                if (voiceModal) {
                    voiceModal.classList.remove('active');
                }

                this.showNotification(`已生成 ${memberChat.name} 的心声`);
            }
        } catch (error) {
            console.error('生成心声失败:', error);
            if (voiceModal) {
                voiceModal.classList.remove('active');
            }
            this.showNotification('生成心声失败，请重试');
        }
    }

    /**
     * 显示群聊心声模态框
     */
    showGroupVoiceModal(memberId) {
        const memberChat = this.getChat(memberId);
        if (!memberChat) return;

        // 获取或创建模态框
        let modal = document.getElementById('voice-thoughts-modal');
        if (!modal) {
            // 如果模态框不存在，创建一个（通常它已经在 index.html 中定义了，这里做兜底）
            modal = document.createElement('div');
            modal.id = 'voice-thoughts-modal';
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>💭 心声</h3>
                        <button class="close-btn" onclick="this.closest('.modal').classList.remove('active')">✕</button>
                    </div>
                    <div class="modal-body">
                        <div id="voice-thoughts-content" style="min-height: 100px; display: flex; align-items: center; justify-content: center;">
                            <div class="spinner"></div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="cancel-btn" onclick="this.closest('.modal').classList.remove('active')">关闭</button>
                        <button class="submit-btn" id="send-voice-thoughts-btn">发送到聊天</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        // 更新标题和内容
        const titleEl = modal.querySelector('.modal-header h3');
        if (titleEl) titleEl.textContent = `💭 ${memberChat.name} 的心声`;

        const contentDiv = modal.querySelector('#voice-thoughts-content');
        contentDiv.innerHTML = `
            <div style="text-align: center;">
                <div class="spinner" style="width: 30px; height: 30px;"></div>
                <p style="margin-top: 15px; color: var(--text-secondary);">正在生成 ${memberChat.name} 的心声...</p>
            </div>
        `;

        modal.classList.add('active');

        // 生成心声内容
        const prompt = `请模拟${memberChat.name}的内心独白。基于角色性格，表达在群聊中的真实想法或感受。用第一人称，简洁自然，不超过80字。`;
        this.callAI(memberId, prompt).then(thoughts => {
            if (thoughts) {
                // 清理情绪标签，用于显示
                const cleanThoughts = thoughts.replace(/\[emotion:.*?\]/gi, '').trim();
                contentDiv.innerHTML = `<p style="font-style: italic; color: #666; line-height: 1.6;">${cleanThoughts}</p>`;
                // 存储心声原文和清理后文本，供发送按钮使用
                modal.dataset.rawThoughts = thoughts;
                modal.dataset.cleanThoughts = cleanThoughts;
                modal.dataset.memberId = memberId;
            } else {
                contentDiv.innerHTML = '<p style="color: #999;">生成心声失败，请重试</p>';
            }
        }).catch(error => {
            console.error('生成心声失败:', error);
            contentDiv.innerHTML = '<p style="color: #999;">生成心声失败，请重试</p>';
        });

        // 绑定发送按钮（只绑定一次）
        const sendBtn = modal.querySelector('#send-voice-thoughts-btn');
        // 移除旧的监听器，避免重复绑定
        const oldHandler = sendBtn._clickHandler;
        if (oldHandler) sendBtn.removeEventListener('click', oldHandler);
        const newHandler = () => {
            const cleanThoughts = modal.dataset.cleanThoughts;
            const rawThoughts = modal.dataset.rawThoughts;
            const targetMemberId = modal.dataset.memberId;
            if (cleanThoughts && rawThoughts && targetMemberId) {
                // 调用发送方法，传入成员ID
                this.sendVoiceThoughtsToChat(targetMemberId, rawThoughts);
                modal.classList.remove('active');
            } else {
                this.showNotification('无法发送，请先生成心声');
            }
        };
        sendBtn.addEventListener('click', newHandler);
        sendBtn._clickHandler = newHandler;
    }

    /**
     * 在模态框中为成员生成心声
     */
    async generateVoiceForMemberInModal(memberId, modal) {
        const contentDiv = modal.querySelector('#group-voice-content');
        try {
            const memberChat = this.getChat(memberId);
            const prompt = `请模拟${memberChat.name}的内心独白。基于角色性格，表达在群聊中的真实想法或感受。用第一人称，简洁自然，不超过80字。`;
            const thoughts = await this.callAI(memberId, prompt);
            if (thoughts) {
                contentDiv.innerHTML = `<p style="font-style: italic; color: #666; line-height: 1.6;">${thoughts}</p>`;
            } else {
                contentDiv.innerHTML = '<p style="color: #999;">生成心声失败，请重试</p>';
            }
        } catch (error) {
            console.error('生成心声失败:', error);
            contentDiv.innerHTML = '<p style="color: #999;">生成心声失败，请重试</p>';
        }
    }

    /**
     * 发送群聊心声到聊天
     */
    sendGroupVoiceToChat(memberId, thoughts) {
        const chat = this.currentChat;
        if (!chat || !chat.isGroup) return;

        const memberChat = this.getChat(memberId);
        const message = {
            id: Date.now() + Math.random(),
            text: thoughts,
            time: this.getRelativeTime(new Date()),
            isMe: false,
            senderId: memberId,
            type: 'voice_card',
            cardContent: thoughts,
            timestamp: new Date().toISOString()
        };
        chat.messages.push(message);
        chat.lastMessage = `[心声] ${memberChat.name}: ${thoughts.substring(0, 20)}...`;
        chat.lastTimestamp = message.timestamp;
        chat.lastTime = this.getRelativeTime(new Date());
        this.saveChats();
        this.renderMessages(chat);
        this.scrollToBottom();
    }

    /**
     * 添加转账消息（特殊样式）
     */
    addTransferMessage(chatId, content, amount, targetId) {
        const chat = this.getChat(chatId);
        if (!chat) return;

        const message = {
            id: Date.now() + Math.random(),
            text: content,
            time: this.getRelativeTime(new Date()),
            isMe: true,
            isTransfer: true,
            transferAmount: amount,
            transferTarget: targetId,
            timestamp: new Date().toISOString(),
            received: false, // 标记转账是否已被接收
            refunded: false // 新增：标记转账是否已被退回
        };

        chat.messages.push(message);
        this.saveChats();

        if (this.currentChat && this.currentChat.id === chatId) {
            this.renderMessages(chat);
            this.scrollToBottom();
        }
    }

    /**
     * 添加等待消息
     */
    addWaitingMessage(chatId, memberId = null) {
        const chat = this.getChat(chatId);
        if (!chat) return null;

        const message = {
            id: 'waiting-' + Date.now(),
            text: '正在生成消息...',
            time: this.getRelativeTime(new Date()),
            isMe: false,
            isWaiting: true,
            memberId: memberId,
            timestamp: new Date().toISOString()
        };

        chat.messages.push(message);

        if (this.currentChat && this.currentChat.id === chatId) {
            this.renderMessages(chat);
        }

        return message.id;
    }

    /**
     * 移除等待消息
     */
    removeWaitingMessage(messageId) {
        const chat = this.currentChat;
        if (!chat || !messageId) return;

        const index = chat.messages.findIndex(msg => msg.id === messageId);
        if (index !== -1) {
            chat.messages.splice(index, 1);
            this.renderMessages(chat);
        }
    }

    /**
     * 渲染成员列表（用于选择）
     */
    renderMemberList(chat) {
        const container = document.getElementById('member-selection-list');
        if (!container) return;

        container.innerHTML = '';

        if (chat.memberIds && chat.memberIds.length > 0) {
            chat.memberIds.forEach(memberId => {
                const member = this.getChat(memberId);
                if (member) {
                    const item = document.createElement('div');
                    item.className = 'member-item';
                    item.innerHTML = `
                        <input type="radio" name="select-member" value="${memberId}" id="member-${memberId}">
                        <label for="member-${memberId}">
                            <div class="member-avatar">
                                <span>${member.avatar || '👤'}</span>
                            </div>
                            <span>${member.name}</span>
                        </label>
                    `;
                    container.appendChild(item);
                }
            });
        }
    }

    /**
     * 获取选中的成员ID
     */
    getSelectedMemberId() {
        const selected = document.querySelector('input[name="select-member"]:checked');
        return selected ? selected.value : null;
    }

    openSettings() {
        if (!this.currentChat) return;

        // 如果是群聊，打开群聊设置页
        if (this.currentChat.isGroup) {
            this.openGroupSettings(this.currentChat.id);
            return;
        }

        const settings = document.getElementById('profile-settings');
        const overlay = document.getElementById('overlay');
        if (!settings || !overlay) return;

        const safeSetValue = (id, value) => { const el = document.getElementById(id); if (el) el.value = value || ''; };
        const safeSetText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value || ''; };
        const safeSetChecked = (id, checked) => { const el = document.getElementById(id); if (el) el.checked = checked || false; };

        safeSetValue('character-name', this.currentChat.name);
        safeSetValue('remark-name', this.currentChat.remarkName);
        safeSetValue('signature', this.currentChat.signature);

        const avatarUrlInput = document.getElementById('avatar-url');
        const avatarEmoji = document.getElementById('settings-avatar-emoji');
        if (avatarUrlInput) avatarUrlInput.value = this.currentChat.avatar || '';
        if (avatarEmoji) {
            const avatar = this.currentChat.avatar || '👤';
            if (avatar && typeof avatar === 'string' && (avatar.startsWith('http://') || avatar.startsWith('https://'))) {
                avatarEmoji.innerHTML = `<img src="${avatar}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">`;
                if (!avatarEmoji.querySelector('.emoji-fallback')) {
                    const fallback = document.createElement('span');
                    fallback.className = 'emoji-fallback';
                    fallback.textContent = '👤';
                    fallback.style.display = 'none';
                    avatarEmoji.appendChild(fallback);
                }
            } else {
                avatarEmoji.innerHTML = `<span>${avatar}</span>`;
            }
        }

        // 设置性别选择框
        const genderSelect = document.getElementById('character-gender');
        if (genderSelect) {
            genderSelect.value = this.currentChat.gender || '';
        }

        const replyTemp = document.getElementById('reply-temp');
        const emojiFreq = document.getElementById('emoji-freq');
        const tempValue = document.getElementById('temp-value');
        const emojiFreqValue = document.getElementById('emoji-freq-value');
        if (replyTemp && tempValue) {
            replyTemp.value = this.currentChat.replyTemp || 0.5;
            tempValue.textContent = replyTemp.value;
            replyTemp.oninput = (e) => { tempValue.textContent = e.target.value; };
        }
        if (emojiFreq && emojiFreqValue) {
            emojiFreq.value = this.currentChat.emojiFreq || 0.5;
            emojiFreqValue.textContent = emojiFreq.value;
            emojiFreq.oninput = (e) => { emojiFreqValue.textContent = e.target.value; };
        }

        const imageFreq = document.getElementById('image-freq');
        const videoFreq = document.getElementById('video-freq');
        const imageFreqValue = document.getElementById('image-freq-value');
        const videoFreqValue = document.getElementById('video-freq-value');
        if (imageFreq && imageFreqValue) {
            imageFreq.value = this.currentChat.imageFrequency || 0;
            imageFreqValue.textContent = imageFreq.value;
            imageFreq.oninput = (e) => { imageFreqValue.textContent = e.target.value; };
        }
        if (videoFreq && videoFreqValue) {
            videoFreq.value = this.currentChat.videoFrequency || 0;
            videoFreqValue.textContent = videoFreq.value;
            videoFreq.oninput = (e) => { videoFreqValue.textContent = e.target.value; };
        }

        const moodFreq = document.getElementById('mood-diary-freq');
        const moodFreqValue = document.getElementById('mood-diary-freq-value');
        if (moodFreq && moodFreqValue) {
            moodFreq.value = this.currentChat.moodDiaryFrequency || 0.7;
            moodFreqValue.textContent = moodFreq.value;
            moodFreq.oninput = (e) => { moodFreqValue.textContent = e.target.value; };
        }

        // 动态渲染世界观下拉框
        const worldSelect = document.getElementById('world-id');
        if (worldSelect) {
            // 清空现有选项（保留第一个空选项）
            while (worldSelect.options.length > 1) {
                worldSelect.remove(1);
            }
            // 从 this.worldBooks 中读取所有世界观并添加为选项
            if (this.worldBooks && this.worldBooks.length > 0) {
                this.worldBooks.forEach(world => {
                    const option = document.createElement('option');
                    option.value = world.id;
                    option.textContent = world.name;
                    worldSelect.appendChild(option);
                });
            }
            // 设置当前选中的值
            worldSelect.value = this.currentChat.worldId || '';
        }
        // 移除dynamic-freq相关代码
        safeSetValue('personality-prompt', this.currentChat.personalityPrompt);
        safeSetChecked('auto-reply-switch', this.currentChat.autoReply);

        // 设置自动回复频率数值和单位
        const autoReplyInterval = document.getElementById('auto-reply-interval');
        const autoReplyUnit = document.getElementById('auto-reply-unit');
        if (autoReplyInterval) autoReplyInterval.value = this.currentChat.autoReplyInterval || 3;
        if (autoReplyUnit) autoReplyUnit.value = this.currentChat.autoReplyUnit || 'minute';

        safeSetValue('nickname', this.currentChat.nickname);
        safeSetValue('pat-style', this.currentChat.patStyle);
        safeSetValue('chat-bg', this.currentChat.chatBg);
        // 移除world-book相关代码

        // 渲染配对角色标签
        this.renderPartnerTags();

        // 气泡样式控件
        const bubbleShape = document.getElementById('bubble-shape');
        const bubbleBgColor = document.getElementById('bubble-bg-color');
        const bubblePattern = document.getElementById('bubble-pattern');
        const bubbleTextColor = document.getElementById('bubble-text-color');
        if (bubbleShape) bubbleShape.value = this.currentChat.bubbleShape || 'rounded';
        if (bubbleBgColor) bubbleBgColor.value = this.currentChat.bubbleBgColor || '#e9ecef';
        if (bubblePattern) bubblePattern.value = this.currentChat.bubblePattern || 'none';
        if (bubbleTextColor) bubbleTextColor.value = this.currentChat.bubbleTextColor || '#212529';

        // 移除固定NPC相关代码

        settings.classList.add('active');
        overlay.classList.add('active');

        // 控制删除角色按钮的显示（仅单聊显示，群聊隐藏）
        const deleteBtn = document.getElementById('delete-character-btn');
        if (deleteBtn) {
            if (this.currentChat && !this.currentChat.isGroup) {
                deleteBtn.style.display = 'block';
                deleteBtn.onclick = () => this.deleteCurrentCharacter();
            } else {
                deleteBtn.style.display = 'none';
            }
        }

        const saveBtn = document.getElementById('save-settings');
        const closeBtn = document.getElementById('close-settings');
        if (saveBtn) saveBtn.onclick = () => this.saveSettings();
        if (closeBtn) closeBtn.onclick = () => this.closeSettings();

        if (bubbleShape) bubbleShape.onchange = () => this.updateBubblePreview();
        if (bubbleBgColor) bubbleBgColor.oninput = () => this.updateBubblePreview();
        if (bubblePattern) bubblePattern.onchange = () => this.updateBubblePreview();
        if (bubbleTextColor) bubbleTextColor.oninput = () => this.updateBubblePreview();
        this.updateBubblePreview();
    }

    saveSettings() {
        try {
            const nameInput = document.getElementById('character-name');
            const remarkInput = document.getElementById('remark-name');
            const signatureTextarea = document.getElementById('signature');
            const replyTemp = document.getElementById('reply-temp');
            const emojiFreq = document.getElementById('emoji-freq');
            const avatarEmoji = document.getElementById('settings-avatar-emoji');
            const worldIdSelect = document.getElementById('world-id');
            const partnerIdSelect = document.getElementById('partner-id');
            const personalityPromptTextarea = document.getElementById('personality-prompt');
            const autoReplyCheckbox = document.getElementById('auto-reply-switch');
            const autoReplyIntervalInput = document.getElementById('auto-reply-interval');
            const autoReplyUnitSelect = document.getElementById('auto-reply-unit');
            const nicknameInput = document.getElementById('nickname');
            const patStyleInput = document.getElementById('pat-style');
            const chatBgInput = document.getElementById('chat-bg');
            const avatarUrlInput = document.getElementById('avatar-url');

            this.currentChat.remarkName = remarkInput?.value || '';
            this.currentChat.signature = signatureTextarea?.value || '';
            this.currentChat.name = nameInput?.value || this.currentChat.name;
            this.currentChat.replyTemp = parseFloat(replyTemp?.value || 0.5);
            this.currentChat.emojiFreq = parseFloat(emojiFreq?.value || 0.5);
            this.currentChat.imageFrequency = parseFloat(document.getElementById('image-freq')?.value || 0);
            this.currentChat.videoFrequency = parseFloat(document.getElementById('video-freq')?.value || 0);
            this.currentChat.moodDiaryFrequency = parseFloat(document.getElementById('mood-diary-freq')?.value || 0.7);
            this.currentChat.avatar = avatarUrlInput?.value || avatarEmoji?.textContent || '👤';
            this.currentChat.worldId = worldIdSelect?.value || null;
            // 移除partnerId的单选框，改为数组
            this.currentChat.personalityPrompt = personalityPromptTextarea?.value || '';
            this.currentChat.autoReply = autoReplyCheckbox?.checked || false;
            // 保存自动回复频率数值和单位
            this.currentChat.autoReplyInterval = parseInt(document.getElementById('auto-reply-interval')?.value || 3);
            this.currentChat.autoReplyUnit = document.getElementById('auto-reply-unit')?.value || 'minute';
            this.currentChat.nickname = nicknameInput?.value || '';
            this.currentChat.patStyle = patStyleInput?.value || '';
            this.currentChat.chatBg = chatBgInput?.value || '';

            // 保存性别
            this.currentChat.gender = document.getElementById('character-gender')?.value || '';

            // 保存气泡样式
            this.currentChat.bubbleShape = document.getElementById('bubble-shape')?.value || 'rounded';
            this.currentChat.bubbleBgColor = document.getElementById('bubble-bg-color')?.value || '#e9ecef';
            this.currentChat.bubblePattern = document.getElementById('bubble-pattern')?.value || 'none';
            this.currentChat.bubbleTextColor = document.getElementById('bubble-text-color')?.value || '#212529';

            this.saveChats();
            this.closeSettings();

            // 重启当前聊天的自动回复定时器
            this.stopAutoReplyTimerForChat(this.currentChat.id);
            if (this.currentChat.autoReply) {
                this.startAutoReplyTimerForChat(this.currentChat.id);
            }

            const chatTitle = document.getElementById('chat-title');
            const chatSignature = document.getElementById('chat-signature');
            const chatAvatar = document.getElementById('chat-avatar-emoji');
            const displayName = this.getDisplayName(this.currentChat);
            if (chatTitle) chatTitle.textContent = displayName;
            if (chatAvatar) {
                const avatar = this.currentChat.avatar;
                if (avatar && typeof avatar === 'string' && (avatar.startsWith('http://') || avatar.startsWith('https://'))) {
                    chatAvatar.innerHTML = `<img src="${avatar}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">`;
                    if (!chatAvatar.querySelector('.emoji-fallback')) {
                        const fallback = document.createElement('span');
                        fallback.className = 'emoji-fallback';
                        fallback.textContent = '👤';
                        fallback.style.display = 'none';
                        chatAvatar.appendChild(fallback);
                    }
                } else {
                    chatAvatar.innerHTML = `<span>${avatar || '👤'}</span>`;
                }
            }
            if (chatSignature) {
                if (this.currentChat.signature) {
                    chatSignature.textContent = this.currentChat.signature;
                    chatSignature.style.display = 'block';
                } else {
                    chatSignature.style.display = 'none';
                }
            }

            this.renderChatList();
            this.renderContacts();

            const chatWindow = document.getElementById('chat-window');
            if (this.currentChat && chatWindow && chatWindow.classList.contains('active')) {
                this.renderMessages(this.currentChat);
                this.updateChatBackground(this.currentChat);
                this.applyBubbleStyle(this.currentChat);
            }
            // 如果当前聊天窗口是打开的这个聊天，则根据新的 autoReply 设置重启定时器
            if (this.currentChat) {
                this.clearAutoReplyTimer();
                if (this.currentChat.autoReply) {
                    this.startAutoReplyTimer(this.currentChat.id);
                }
            }
            this.showNotification('设置已保存');
        } catch (error) {
            console.error('保存设置失败:', error);
            this.showNotification('保存失败，请检查控制台');
        }
    }

    renderFixedNPCList() {
        const npcListEl = document.getElementById('fixed-npc-list');
        if (!npcListEl || !this.currentChat) return;
        if (this.currentChat.fixedNPCs && this.currentChat.fixedNPCs.length > 0) {
            npcListEl.innerHTML = this.currentChat.fixedNPCs.map((npc, index) => `
                <div class="npc-item">
                    <div class="npc-avatar">${npc.avatar || '👤'}</div>
                    <div class="npc-info">
                        <div class="npc-name">NPC${index + 1}: ${npc.name}</div>
                        <div class="npc-desc">${npc.setting || npc.description || ''}</div>
                    </div>
                    <div class="npc-actions">
                        <button class="edit-npc-btn" onclick="chatManager.editFixedNPC(${index})">✏️</button>
                        <button class="delete-npc-btn" onclick="chatManager.deleteFixedNPC(${index})">✕</button>
                    </div>
                </div>
            `).join('');
        } else {
            npcListEl.innerHTML = '<div class="empty-npc-text">暂无固定NPC</div>';
        }
    }

    toggleNPCForm() {
        const form = document.getElementById('npc-form');
        if (!form) return;
        const isVisible = form.style.display !== 'none';
        form.style.display = isVisible ? 'none' : 'block';
        if (!isVisible && this.editingNPCIndex === null) {
            document.getElementById('npc-name').focus();
        }
    }

    confirmAddNPC() {
        const nameInput = document.getElementById('npc-name');
        const settingInput = document.getElementById('npc-setting');
        const relationInput = document.getElementById('npc-relation');
        const npcName = nameInput.value.trim();

        if (!npcName) {
            this.showNotification('请输入NPC名称！');
            nameInput.focus();
            return;
        }

        const world = this.worldBooks.find(w => w.id === this.currentWorldId);
        if (!world) {
            this.showNotification('请先选择或创建一个世界观');
            return;
        }

        // 检查是否在编辑模式下（有隐藏的编辑索引）
        const editingIndex = world.npcs.findIndex(n => n._editing);
        if (editingIndex !== -1) {
            // 更新现有 NPC
            world.npcs[editingIndex] = {
                ...world.npcs[editingIndex],
                name: npcName,
                setting: settingInput.value.trim() || '',
                relationToOC: relationInput.value.trim() || ''
            };
            delete world.npcs[editingIndex]._editing;
        } else {
            // 添加新 NPC
            if (!world.npcs) world.npcs = [];
            const npcData = {
                id: `npc_${Date.now()}`,
                name: npcName,
                avatar: '👤',
                setting: settingInput.value.trim() || '',
                relationToOC: relationInput.value.trim() || ''
            };
            world.npcs.push(npcData);
        }

        localStorage.setItem('worldBooks', JSON.stringify(this.worldBooks));
        this.renderNPCList(world.npcs);
        this.clearWorldNPCForm();
    }

    confirmWorldNPC() {
        const nameInput = document.getElementById('world-npc-name');
        const avatarInput = document.getElementById('world-npc-avatar');
        const settingInput = document.getElementById('world-npc-setting');
        const relationInput = document.getElementById('world-npc-relation');
        const npcName = nameInput.value.trim();

        if (!npcName) {
            this.showNotification('请输入NPC名称！');
            nameInput.focus();
            return;
        }

        const world = this.worldBooks.find(w => w.id === this.currentWorldId);
        if (!world) {
            this.showNotification('请先选择或创建一个世界观');
            return;
        }

        // 获取头像URL或emoji
        const avatarValue = avatarInput.value.trim() || '👤';

        // 检查是否在编辑模式下（有隐藏的编辑索引）
        const editingIndex = world.npcs.findIndex(n => n._editing);
        if (editingIndex !== -1) {
            // 更新现有 NPC
            world.npcs[editingIndex] = {
                ...world.npcs[editingIndex],
                name: npcName,
                avatar: avatarValue,
                setting: settingInput.value.trim() || '',
                relationToOC: relationInput.value.trim() || ''
            };
            delete world.npcs[editingIndex]._editing;
        } else {
            // 添加新 NPC
            if (!world.npcs) world.npcs = [];
            const npcData = {
                id: `npc_${world.id}_${Date.now()}`,
                name: npcName,
                avatar: avatarValue,
                setting: settingInput.value.trim() || '',
                relationToOC: relationInput.value.trim() || ''
            };
            world.npcs.push(npcData);
        }

        localStorage.setItem('worldBooks', JSON.stringify(this.worldBooks));
        this.renderNPCList(world.npcs);
        this.clearWorldNPCForm();
    }

    clearWorldNPCForm() {
        document.getElementById('world-npc-name').value = '';
        document.getElementById('world-npc-avatar').value = '';
        document.getElementById('world-npc-setting').value = '';
        document.getElementById('world-npc-relation').value = '';
    }

clearNPCForm() {
        const nameInput = document.getElementById('npc-name');
        const settingInput = document.getElementById('npc-setting');
        const relationInput = document.getElementById('npc-relation');
        if (nameInput) nameInput.value = '';
        if (settingInput) settingInput.value = '';
        if (relationInput) relationInput.value = '';
    }

    addFixedNPC() { this.toggleNPCForm(); }

    editFixedNPC(index) {
        if (!this.currentChat.fixedNPCs || index < 0 || index >= this.currentChat.fixedNPCs.length) return;
        const npc = this.currentChat.fixedNPCs[index];
        this.editingNPCIndex = index;
        document.getElementById('npc-name').value = npc.name;
        document.getElementById('npc-setting').value = npc.setting || npc.description || '';
        document.getElementById('npc-relation').value = npc.relationToOC || '';
        const form = document.getElementById('npc-form');
        if (form) form.style.display = 'block';
        document.getElementById('npc-name').focus();
    }

    cancelNPCForm() {
        const form = document.getElementById('npc-form');
        ['npc-name', 'npc-setting', 'npc-relation'].forEach(id => {
            const input = document.getElementById(id);
            if (input) input.value = '';
        });
        if (form) form.style.display = 'none';
        this.editingNPCIndex = null;
    }

    deleteFixedNPC(index) {
        if (!this.currentChat.fixedNPCs || index < 0 || index >= this.currentChat.fixedNPCs.length) return;
        if (confirm('确定要删除这个NPC吗？')) {
            this.currentChat.fixedNPCs.splice(index, 1);
            this.saveChats();
            // 移除固定NPC相关代码
        }
    }

    async rotateField(fieldName, event) {
        event.stopPropagation();
        const chat = this.currentChat;
        if (!chat) return;
        try {
            const generatedContent = await this.callAIGenerate(chat, fieldName);
            const fieldIdMap = { 'patStyle': 'pat-style' };
            const inputId = fieldIdMap[fieldName] || fieldName;
            const inputElement = document.getElementById(inputId);
            if (inputElement && generatedContent) {
                inputElement.value = generatedContent;
                this.showNotification(fieldName === 'patStyle' ? '拍一拍样式已生成' : `${fieldName}已生成并保存`);
            }
        } catch (error) {
            console.error('生成内容失败:', error);
            this.showNotification('生成失败，请检查API配置');
        }
    }

    async callAIGenerate(chat, fieldName) {
        const settings = this.mammySettings;

        // 如果未配置 API，回退到模拟回复
        if (!settings.apiUrl || !settings.apiKey || !settings.modelName) {
            return this.simulateAIResponse(chat, fieldName);
        }

        let systemPrompt = `你是${chat.name}`;
        if (chat.personalityPrompt) systemPrompt += `，你的性格：${chat.personalityPrompt}`;
        if (chat.worldId) systemPrompt += `。世界观：${chat.worldId}`;
        if (chat.nickname) systemPrompt += `。你的网名：${chat.nickname}`;

        let fieldPrompt = '';
        switch(fieldName) {
            case 'nickname':
                fieldPrompt = '请为这个角色生成一个合适的网名，要求符合角色性格和世界观，长度不超过10个字符。只需要输出网名本身，不要任何额外文字或解释。';
                break;
            case 'signature':
                fieldPrompt = '请为这个角色生成一个个性签名，要求简洁有个性，长度不超过20个字符。只需要输出签名本身，不要任何额外文字或解释。';
                break;
            case 'patStyle':
                fieldPrompt = '请为这个角色生成一个拍一拍文案，格式如"拍了拍XX的XXX"，要求有趣有创意，长度不超过20个字符。只需要输出拍一拍文案本身，不要任何额外文字或解释。';
                break;
            default:
                fieldPrompt = `请为这个角色生成一个合适的${fieldName}。只需要输出结果本身，不要任何额外文字或解释。`;
        }

        const messages = [
            { role: "system", content: systemPrompt + fieldPrompt },
            { role: "user", content: "请直接生成" + fieldName }
        ];

        try {
            const response = await fetch(settings.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${settings.apiKey}`
                },
                body: JSON.stringify({
                    model: settings.modelName,
                    messages: messages,
                    temperature: chat.replyTemp || 0.5,
                                    })
            });

            const data = await response.json();

            if (data.choices && data.choices[0] && data.choices[0].message) {
                return data.choices[0].message.content;
            } else {
                console.error('AI 生成 API 返回异常', data);
                return this.simulateAIResponse(chat, fieldName);
            }
        } catch (error) {
            console.error('AI 生成失败', error);
            return this.simulateAIResponse(chat, fieldName);
        }
    }

    simulateAIResponse(chat, fieldName) {
        const responses = { nickname: `${chat.name}的AI网名`, signature: `${chat.name}的个性签名`, patStyle: `拍了拍${chat.name}的头` };
        return responses[fieldName] || `${chat.name}的${fieldName}`;
    }

    showNotification(message, duration = 2000) {
        console.log("通知：", message);
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.textContent = message;
        document.body.appendChild(notification);

        // 添加动画类
        setTimeout(() => notification.classList.add('show'), 10);

        // 自动移除
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, duration);
    }

    /**
     * @功能相关方法
     */
    showDynamicMentionModal() {
        const modal = document.getElementById('dynamic-mention-modal');
        if (!modal) return;

        const container = document.getElementById('dynamic-mention-list');
        if (!container) return;

        // 获取所有单人聊天角色（排除群聊和妈咪）
        const contacts = this.contacts.filter(c => !c.isGroup && c.id !== 'user_mummy' && c.id !== 'mammy');

        if (contacts.length === 0) {
            container.innerHTML = '<p style="padding: 12px; text-align: center; color: var(--text-secondary);">暂无可@的好友</p>';
        } else {
            container.innerHTML = contacts.map(contact => {
                const chat = this.getChat(contact.id);
                const displayName = chat ? (chat.nickname || chat.remarkName || chat.name) : contact.name;
                const avatar = contact.avatar || '👤';
                let avatarHtml;
                if (avatar && typeof avatar === 'string' && (avatar.startsWith('http://') || avatar.startsWith('https://'))) {
                    avatarHtml = `<img src="${avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
                } else {
                    avatarHtml = `<span>${avatar}</span>`;
                }

                const isChecked = this.tempMentionedUsers.some(u => u.id === contact.id);

                return `
                    <div class="member-item" data-id="${contact.id}">
                        <input type="checkbox" id="mention-${contact.id}" value="${contact.id}" ${isChecked ? 'checked' : ''}>
                        <label for="mention-${contact.id}" style="display: flex; align-items: center; gap: 10px; width: 100%; cursor: pointer;">
                            <div class="member-avatar" style="width: 40px; height: 40px; border-radius: 50%; background: var(--nav-active-bg); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                ${avatarHtml}
                            </div>
                            <span style="font-size: 14px; color: var(--text-primary);">${displayName}</span>
                        </label>
                    </div>
                `;
            }).join('');
        }

        modal.classList.add('active');
    }

    openPublishDynamicModal() {
        const modal = document.getElementById('publish-dynamic-modal');
        if (modal) modal.classList.add('active');

        // 绑定 @ 按钮
        const mentionBtn = document.getElementById('dynamic-mention-btn');
        if (mentionBtn) {
            mentionBtn.onclick = () => this.showDynamicMentionModal();
        }

        // 绑定确认按钮
        const confirmBtn = document.getElementById('dynamic-mention-confirm');
        if (confirmBtn) {
            confirmBtn.onclick = () => this.confirmDynamicMention();
        }

        // 清空临时 @ 用户并渲染标签
        this.tempMentionedUsers = [];
        this.renderDynamicMentionTags();
    }

    closeDynamicMentionModal() {
        const modal = document.getElementById('dynamic-mention-modal');
        if (modal) modal.classList.remove('active');
    }

    confirmDynamicMention() {
        const container = document.getElementById('dynamic-mention-list');
        if (!container) return;

        const checkboxes = container.querySelectorAll('input[type="checkbox"]:checked');
        this.tempMentionedUsers = Array.from(checkboxes).map(cb => {
            const contact = this.contacts.find(c => c.id === cb.value);
            const chat = this.getChat(cb.value);
            const name = chat ? (chat.nickname || chat.remarkName || chat.name) : contact.name;
            return { id: cb.value, name };
        });

        this.renderDynamicMentionTags();
        this.closeDynamicMentionModal();
    }

    renderDynamicMentionTags() {
        const container = document.getElementById('dynamic-mentioned-tags');
        if (!container) return;

        if (this.tempMentionedUsers.length === 0) {
            container.innerHTML = '';
        } else {
            container.innerHTML = this.tempMentionedUsers.map(user => `
                <div class="dynamic-mention-tag">
                    @${user.name}
                    <span class="remove-mention" onclick="chatManager.removeDynamicMentionedUser('${user.id}')">✕</span>
                </div>
            `).join('');
        }
    }

    removeDynamicMentionedUser(userId) {
        this.tempMentionedUsers = this.tempMentionedUsers.filter(u => u.id !== userId);
        this.renderDynamicMentionTags();
    }

    /**
     * 触发被@用户的评论
     */
    async triggerMentionedRepliesForDynamic(dynamic) {
        if (!dynamic.mentionedUserIds || !Array.isArray(dynamic.mentionedUserIds)) {
            return; // 防御性检查，避免遍历 undefined 或非数组
        }
        for (const userId of dynamic.mentionedUserIds) {
            const chat = this.getChat(userId);
            if (!chat) continue;

            // 如果已经评论过，则跳过
            if (dynamic.comments && dynamic.comments.some(c => c.authorId === userId)) {
                console.log(`被@用户 ${chat.name} 已经评论过，跳过`);
                continue;
            }

            // 随机延迟 2-5 秒
            const delay = Math.random() * 3000 + 2000;
            await new Promise(resolve => setTimeout(resolve, delay));

            // 生成评论
            await this.simulateCommentFromUser(dynamic.id, chat, dynamic.content);
        }
    }

    /**
     * 模拟用户评论
     */
    async simulateCommentFromUser(dynamicId, userChat, dynamicContent) {
        const dynamic = this.dynamics.find(d => d.id === dynamicId);
        if (!dynamic) return;

        try {
            // 构建评论提示词
            const commentPrompt = this.buildPromptForOC(userChat, 'comment_dynamic', {
                dynamicAuthor: dynamic.author,
                dynamicAuthorId: dynamic.authorId,  // 新增
                dynamicContent: dynamicContent
            });

            // 调用AI生成评论内容
            let commentContent = await this.callAIForDynamic(commentPrompt);

            // 如果是配对角色，强制必须有评论
            const isPartner = dynamic.authorId && userChat.partnerIds?.includes(dynamic.authorId);
            if (isPartner) {
                // 如果 AI 返回了拒绝评论的内容或为空，则强制生成一条符合关系的评论
                const rejectPatterns = ['（不评论）', '不评论', '保持沉默', '...', '。', ''];
                if (!commentContent || rejectPatterns.includes(commentContent.trim())) {
                    console.warn(`[配对角色强制评论] ${userChat.name} 原本输出拒绝评论，将重新生成或使用默认语句`);
                    // 尝试重新生成一次，使用更直接的提示
                    const forcePrompt = `你是${userChat.name}，你的配对角色${dynamic.author}发了一条动态："${dynamic.content}"。作为TA的恋人/伴侣，你必须回复一句话，不能沉默。回复要符合你的性格，简短口语化。直接输出内容，不要引号。`;
                    let retryContent = await this.callAIForDynamic(forcePrompt);
                    if (!retryContent || rejectPatterns.includes(retryContent.trim())) {
                        // 仍失败则使用预设语句
                        const defaultComments = ['嗯。', '在。', '…', '（轻轻点头）', '我在。'];
                        retryContent = defaultComments[Math.floor(Math.random() * defaultComments.length)];
                    }
                    commentContent = retryContent;
                }
            }

            if (!commentContent || commentContent.trim() === '') {
                console.warn(`[评论跳过] ${userChat.name} 对动态 ${dynamicId} 的 AI 评论生成失败或返回空内容，本次不评论。`);
                return false; // 直接返回，不添加评论，并返回 false 表示失败
            }

            // 添加评论
            const newComment = {
                authorId: userChat.id,
                authorName: this.getDynamicDisplayName(userChat),
                content: commentContent,
                timestamp: Date.now()
            };

            if (!dynamic.comments) dynamic.comments = [];
            dynamic.comments.push(newComment);
            this.saveDynamics();
            this.renderDynamics();

            console.log(`${userChat.name} 评论了 ${dynamic.author} 的动态: ${commentContent}`);

            // *** 关键修改：由动态作者回复这条评论，而不是评论者自己回复自己 ***
            const replyDelay = Math.floor(Math.random() * 5000) + 5000;
            setTimeout(async () => {
                const authorChat = this.getChat(dynamic.authorId);
                // 增加判断：作者不能是妈咪，且作者不能是评论者本人
                if (authorChat && authorChat.id !== 'user_mummy' && authorChat.id !== newComment.authorId) {
                    // 判断是否为配对角色的评论
                    const isPartnerComment = authorChat.partnerIds && authorChat.partnerIds.includes(newComment.authorId);
                    // 配对角色100%回复，非配对角色25%概率回复
                    const shouldReply = isPartnerComment ? true : (Math.random() < 0.25);
                    if (shouldReply) {
                        // 调用作者的回复逻辑，回复这条新评论
                        await this.simulateReplyFromDynamicAuthor(dynamic, authorChat, newComment);
                    }
                }
            }, replyDelay);

        } catch (error) {
            console.error(`生成评论失败:`, error);
        }
    }

    /**
     * AI生成评论
     */
    async generateAIComment(chat, dynamicContent) {
        // 简单的AI评论生成逻辑
        const comments = [
            '这个动态很有意思！',
            '我也有同感',
            '谢谢分享！',
            '很棒的想法',
            '赞同你的观点',
            '很有意思的内容',
            '感谢你的分享',
            '这个角度很独特'
        ];

        // 模拟AI生成，随机选择一个评论
        return comments[Math.floor(Math.random() * comments.length)];
    }

    // 启动动态自动生成定时器
    startAutoDynamicTimer() {
        if (this.autoDynamicTimer) clearInterval(this.autoDynamicTimer);

        // 获取用户配置的间隔值
        const dynamicsCfg = this.mammySettings?.autoGenerate?.dynamics;
        const intervalVal = dynamicsCfg?.intervalValue || 30;
        const unit = dynamicsCfg?.intervalUnit || 'minute';

        let intervalMs;
        switch (unit) {
            case 'minute': intervalMs = intervalVal * 60 * 1000; break;
            case 'hour': intervalMs = intervalVal * 60 * 60 * 1000; break;
            case 'day': intervalMs = intervalVal * 24 * 60 * 60 * 1000; break;
            default: intervalMs = 30 * 60 * 1000;
        }
        this.autoDynamicIntervalMs = intervalMs;

        this.autoDynamicTimer = setInterval(() => {
            if (this.mammySettings?.autoGenerate?.dynamics?.enabled) {
                this.generateDynamicsInBackground();
            }
        }, this.autoDynamicIntervalMs);

        console.log('动态自动生成定时器已启动，间隔', this.autoDynamicIntervalMs / 60000, '分钟');
    }

    // 停止动态自动生成定时器
    stopAutoDynamicTimer() {
        if (this.autoDynamicTimer) {
            clearInterval(this.autoDynamicTimer);
            this.autoDynamicTimer = null;
            console.log('动态自动生成定时器已停止');
        }
    }

    // 启动群聊自动发言定时器
    startGroupAutoChatTimer() {
        if (this.groupAutoChatTimer) clearInterval(this.groupAutoChatTimer);
        this.groupAutoChatTimer = setInterval(() => {
            this.checkAndTriggerGroupAutoChat();
        }, 60000); // 每分钟检查一次
    }

    // 检查并触发群聊自动发言
    checkAndTriggerGroupAutoChat() {
        const now = Date.now();
        this.chats.forEach(chat => {
            if (!chat.isGroup || !chat.autoChatEnabled) return;
            const lastActive = chat.lastActivityTimestamp ? new Date(chat.lastActivityTimestamp).getTime() : 0;
            const baseInterval = this.getIntervalMs(chat.autoChatIntervalValue, chat.autoChatIntervalUnit);
            const speedFactor = chat.replySpeedFactor || 1.0;
            const intervalMs = baseInterval * speedFactor;
            if (now - lastActive >= intervalMs) {
                this.triggerGroupAutoMessage(chat);
            }
        });
    }

    // 获取间隔时间（毫秒）
    getIntervalMs(val, unit) {
        switch(unit) {
            case 'minute': return val * 60 * 1000;
            case 'hour': return val * 60 * 60 * 1000;
            case 'day': return val * 24 * 60 * 60 * 1000;
            default: return 30 * 60 * 1000;
        }
    }

    // 触发群聊自动发言
    async triggerGroupAutoMessage(chat) {
        const members = chat.members.filter(id => {
            const mute = chat.mutedMembers?.[id];
            return !mute || (mute !== 'forever' && mute <= Date.now());
        });
        if (members.length === 0) return;

        const randomMemberId = members[Math.floor(Math.random() * members.length)];
        const memberChat = this.getChat(randomMemberId);
        if (!memberChat) return;

        // 使用完整的群成员上下文提示词
        const systemPrompt = this.getMemberContextPrompt(randomMemberId, chat.id);
        if (!systemPrompt) return;

        const userPrompt = `（系统提示：群聊已经沉默了一段时间。请主动说点什么，可以开启一个新话题。注意：
- 不要谈论天气、吃饭、睡觉等无聊话题。
- 可以分享一件你今天遇到的小事、吐槽某人、表达对某事的看法、询问他人意见，但必须符合你的性格和世界观。
- 如果你有配对角色在群里，可以尝试@对方或提及对方。
- 如果你今天心情不好，也可以直接抱怨或发牢骚。）`;

        // 直接调用 API，绕过 callAI 的复杂触发逻辑
        try {
            const reply = await this.callAIDirect(systemPrompt, userPrompt, memberChat.replyTemp || 0.5);
            if (reply) {
                await this.addMessageWithEmotion(chat.id, reply, false, randomMemberId);
                chat.lastActivityTimestamp = new Date().toISOString();
                this.saveChats();

                // 根据频率主动发送图片/视频
                const npcSettings = chat?.npcSettings?.[randomMemberId] || {};
                const imageFreq = npcSettings.imageFrequency ?? 0;
                const videoFreq = npcSettings.videoFrequency ?? 0;
                // 分别判断图片和视频，各自独立概率
                if (Math.random() < imageFreq) {
                    // 异步发送，不阻塞回复
                    setTimeout(() => this.sendAIMediaCard(chat.id, 'image', false, randomMemberId), 300);
                }
                if (Math.random() < videoFreq) {
                    setTimeout(() => this.sendAIMediaCard(chat.id, 'video', false, randomMemberId), 300);
                }
            }
        } catch (e) {
            console.error('群自动发言失败', e);
        }
    }

    // 后台生成动态（供定时器调用）
    async generateDynamicsInBackground() {
        console.log('后台自动生成动态中...');
        const contacts = this.contacts.filter(c => !c.isGroup && c.id !== 'user_mummy');
        const ocFrequencies = this.mammySettings?.autoGenerate?.dynamics?.ocFrequencies || {};

        // 逐个角色判断是否生成（按频率概率）
        for (const contact of contacts) {
            const freq = ocFrequencies[contact.id] ?? 0;
            if (freq === 0) continue;
            if (Math.random() < freq / 10) {
                const chat = this.getChat(contact.id);
                if (chat) {
                    await this.generateDynamicForOC(chat);
                    // 随机间隔 10-30 秒，避免扎堆
                    await new Promise(r => setTimeout(r, 10000 + Math.random() * 20000));
                }
            }
        }
        console.log('后台自动生成动态完成');
    }

    // 启动论坛自动生成定时器
    startAutoForumTimer() {
        if (this.autoForumTimer) clearInterval(this.autoForumTimer);

        const forumCfg = this.mammySettings?.autoGenerate?.forum;
        const intervalVal = forumCfg?.intervalValue || 30;
        const unit = forumCfg?.intervalUnit || 'minute';

        let intervalMs;
        switch (unit) {
            case 'minute': intervalMs = intervalVal * 60 * 1000; break;
            case 'hour': intervalMs = intervalVal * 60 * 60 * 1000; break;
            case 'day': intervalMs = intervalVal * 24 * 60 * 60 * 1000; break;
            default: intervalMs = 30 * 60 * 1000;
        }

        this.autoForumTimer = setInterval(() => {
            if (this.mammySettings?.autoGenerate?.forum?.enabled) {
                this.generateForumPostsInBackground();
            }
        }, intervalMs);

        console.log('论坛自动生成定时器已启动，间隔', intervalMs / 60000, '分钟');
    }

    // 停止论坛自动生成定时器
    stopAutoForumTimer() {
        if (this.autoForumTimer) {
            clearInterval(this.autoForumTimer);
            this.autoForumTimer = null;
            console.log('论坛自动生成定时器已停止');
        }
    }

    // 后台生成论坛帖子（供定时器调用）
    async generateForumPostsInBackground() {
        console.log('后台自动生成论坛帖子中...');

        // 基于频率和人数/篇数设置动态计算帖子数量
        const forumSettings = this.mammySettings?.autoGenerate?.forum || {};
        const ocFreq = forumSettings.ocFrequencies || {};
        const ocPostCounts = forumSettings.ocPostCounts || {};
        const fixedNPCFreq = forumSettings.fixedNPCFreq || 0;
        const fixedNPCCount = forumSettings.fixedNPCCount || 1;
        const writerFreq = forumSettings.writerFreq || 0;
        const writerCount = forumSettings.writerCount || 1;
        const randomNPCFreq = forumSettings.randomNPCFreq || 0;
        const randomNPCCount = forumSettings.randomNPCCount || 1;

        let totalPlannedPosts = 0;

        // OC：频率 > 0 则可能发帖，频率=10 必定发满设定篇数
        for (const [ocId, freq] of Object.entries(ocFreq)) {
            if (freq === 0) continue;
            const maxCount = ocPostCounts[ocId] || 1;
            if (freq === 10) {
                totalPlannedPosts += maxCount;
            } else {
                // 频率 1-9：概率触发，篇数在 1-maxCount 间随机
                if (Math.random() < freq / 10) {
                    totalPlannedPosts += Math.floor(Math.random() * maxCount) + 1;
                }
            }
        }
        // 固定 NPC
        if (fixedNPCFreq === 10) totalPlannedPosts += fixedNPCCount;
        else if (fixedNPCFreq > 0 && Math.random() < fixedNPCFreq / 10) {
            totalPlannedPosts += Math.floor(Math.random() * fixedNPCCount) + 1;
        }
        // 同人太太
        if (writerFreq === 10) totalPlannedPosts += writerCount;
        else if (writerFreq > 0 && Math.random() < writerFreq / 10) {
            totalPlannedPosts += Math.floor(Math.random() * writerCount) + 1;
        }
        // 路人 NPC
        if (randomNPCFreq === 10) totalPlannedPosts += randomNPCCount;
        else if (randomNPCFreq > 0 && Math.random() < randomNPCFreq / 10) {
            totalPlannedPosts += Math.floor(Math.random() * randomNPCCount) + 1;
        }

        const postCount = Math.min(totalPlannedPosts, 10); // 上限 10 篇
        if (postCount === 0) {
            console.log('[论坛AI] 频率未触发，不生成帖子');
            return;
        }

        for (let i = 0; i < postCount; i++) {
            try {
                await this.generateSingleForumPost();
                await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
            } catch (error) {
                console.error('后台生成论坛帖子失败:', error);
            }
        }

        this.renderForum(false);
        console.log('后台自动生成论坛帖子完成');
    }

    /**
     * 打开妈咪中心
     */
    openMammyCenter() {
        const panel = document.getElementById('mammy-center-panel');
        if (!panel) return;
        // loadMammySettings 已经在 init 中调用，这里只需渲染界面
        this.renderMammySettings();
        // 强制刷新自动生成设置，确保新角色滑块出现
        this.renderAutoGenerateSettings();
        panel.classList.add('active');
        // 重新绑定选项卡事件（因为动态添加的内容可能之前未绑定）
        this.bindTabEvents();
    }

    /**
     * 关闭妈咪中心
     */
    closeMammyCenter() {
        const panel = document.getElementById('mammy-center-panel');
        if (panel) panel.classList.remove('active');
    }

    /**
     * 加载妈咪设置
     */
    loadMammySettings() {
        const saved = localStorage.getItem('mammySettings');
        console.log('Loading mammySettings from localStorage:', saved ? 'Found' : 'Not found');
        const defaultSettings = {
            nickname: '妈咪',
            avatar: '👸',
            wallpaper: '',
            wallpaperOpacity: 100, // 壁纸透明度 0-100，0为完全透明，100为完全不透明
            theme: 'default',
            selfSetting: '', // 添加自设字段
            apiUrl: 'https://api.longcat.chat/openai/v1/chat/completions',
            apiKey: '',
            modelName: 'LongCat-Flash-Thinking-2601',
            patStyle: '拍了拍我的头',
            emotions: {
                angry: ['😠', '😤', '🤬'],
                happy: ['😄', '😃', '😁'],
                sad: ['😢', '😭', '😔'],
                surprised: ['😮', '😲', '😱']
            },
            // 全局气泡样式设置
            bubbleShape: 'rounded',
            bubbleBgColor: '#e9ecef',
            bubblePattern: 'none',
            bubbleTextColor: '#212529',
            fontSize: 14, // 全局字体大小，单位 px
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontWeight: 'normal',
            fontStyle: 'normal',
            messageMergeDelay: 3000, // 消息合并延迟，单位毫秒
            autoGenerate: {
                dynamics: {
                    enabled: false,
                    ocFrequencies: {},
                    ocForwardFrequencies: {},   // 新增这一行
                    intervalValue: 30,
                    intervalUnit: 'minute'
                },
                forum: {
                    enabled: false,
                    ocFrequencies: {},
                    fixedNPCFreq: 0,
                    writerFreq: 0,
                    randomNPCFreq: 0
                },
                hotTags: {
                    enabled: false
                },
                contextLength: 10
            },
            writerTemplates: [
                {
                    id: 'template_gufeng',
                    name: '古风穿越太太',
                    prompt: '你是一个热爱写同人文的太太，最喜欢写【OC】穿越到古代/仙侠世界的故事。你的文风华丽，喜欢用诗词典故，脑洞很大。',
                    outputLength: 'medium'
                },
                {
                    id: 'template_xianxia',
                    name: '仙侠修真太太',
                    prompt: '你是一个仙侠修真爱好者，擅长描写修仙世界的爱恨情仇。你的文笔细腻，喜欢描写修炼等级、法宝和门派恩怨。',
                    outputLength: 'long'
                },
                {
                    id: 'template_danmei',
                    name: '现代虐恋太太',
                    prompt: '你是一个现代言情小说写手，擅长写都市男女的虐心爱情故事。你的文笔清新，情节曲折，喜欢写霸道总裁和灰姑娘的故事。',
                    outputLength: 'medium'
                }
            ]
        };

        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                console.log('Successfully parsed mammySettings:', parsed);
                this.mammySettings = parsed;
            } catch (e) {
                console.error('Error parsing mammySettings:', e);
                this.mammySettings = defaultSettings;
                localStorage.setItem('mammySettings', JSON.stringify(this.mammySettings));
            }
        } else {
            this.mammySettings = defaultSettings;
            localStorage.setItem('mammySettings', JSON.stringify(this.mammySettings));
            console.log('Initialized default mammySettings and saved to localStorage');
        }
        // 确保 autoGenerate 结构存在且兼容旧数据
        if (!this.mammySettings.autoGenerate) {
            this.mammySettings.autoGenerate = defaultSettings.autoGenerate;
        } else {
            // 兼容旧版本数据结构
            if (typeof this.mammySettings.autoGenerate.dynamics === 'boolean') {
                const oldDynamics = this.mammySettings.autoGenerate.dynamics;
                const oldDynamicsFreq = this.mammySettings.autoGenerate.dynamicsFreq || 'hourly';
                this.mammySettings.autoGenerate.dynamics = {
                    enabled: oldDynamics,
                    ocFrequencies: {},
                    ocForwardFrequencies: {}   // 新增这一行
                };
            }
            // 在兼容旧版本数据结构的代码附近（大约在 loadMammySettings 中部）添加：
            if (!this.mammySettings.autoGenerate.dynamics.ocForwardFrequencies) {
                this.mammySettings.autoGenerate.dynamics.ocForwardFrequencies = {};
            }
            if (typeof this.mammySettings.autoGenerate.forum === 'boolean') {
                const oldForum = this.mammySettings.autoGenerate.forum;
                this.mammySettings.autoGenerate.forum = {
                    enabled: oldForum,
                    ocFrequencies: {},
                    ocPostCounts: {},
                    fixedNPCFreq: 0,
                    fixedNPCCount: 1,
                    writerFreq: 0,
                    writerCount: 1,
                    randomNPCFreq: 0,
                    randomNPCCount: 1,
                    intervalValue: 30,
                    intervalUnit: 'minute',
                    commentMin: 3,
                    commentMax: 6,
                    commentTemperature: 0.9,
                    likeMin: 2,
                    likeMax: 5
                };
            }
            if (typeof this.mammySettings.autoGenerate.hotTags === 'boolean') {
                const oldHotTags = this.mammySettings.autoGenerate.hotTags;
                this.mammySettings.autoGenerate.hotTags = {
                    enabled: oldHotTags
                };
            }
        }
        // 确保 writerTemplates 存在
        if (!this.mammySettings.writerTemplates) {
            this.mammySettings.writerTemplates = defaultSettings.writerTemplates;
        }

        // 壁纸兼容性修复：如果壁纸URL存在但wallpaperOpacity为0，自动改为100
        if (this.mammySettings.wallpaper && this.mammySettings.wallpaper.trim() !== '' && this.mammySettings.wallpaperOpacity === 0) {
            console.log('Wallpaper compatibility fix: URL exists but opacity is 0, changing to 100');
            this.mammySettings.wallpaperOpacity = 100;
        }

        // 确保partnerIds数组存在
        if (!this.mammySettings.partnerIds) {
            this.mammySettings.partnerIds = [];
        }
        // 确保 fontSize 存在
        if (this.mammySettings.fontSize === undefined) {
            this.mammySettings.fontSize = 14;
        }
        this.renderMammySettings();
        this.renderAutoGenerateSettings();
        this.renderWriterTemplates();
        // 加载世界书数据
        const savedWorldBooks = localStorage.getItem('worldBooks');
        this.worldBooks = savedWorldBooks ? JSON.parse(savedWorldBooks) : [
            {
                id: 'world_wangwang',
                name: '旺旺雪饼组',
                description: '旺旺雪饼世界观设定',
                npcs: [],
                characters: []
            },
            {
                id: 'world_cyber',
                name: '赛博朋克组',
                description: '赛博朋克世界观设定',
                npcs: [],
                characters: []
            },
            {
                id: 'world_langyang',
                name: '狼羊组',
                description: '狼羊组世界观设定',
                npcs: [],
                characters: []
            },
            {
                id: 'world_power',
                name: '权谋组',
                description: '权谋世界观设定',
                npcs: [],
                characters: []
            },
            {
                id: 'world_god',
                name: '神祗组',
                description: '神祗世界观设定',
                npcs: [],
                characters: []
            },
            {
                id: 'world_republic',
                name: '民国组',
                description: '民国世界观设定',
                npcs: [],
                characters: []
            },
            {
                id: 'world_enemy',
                name: '宿敌组',
                description: '宿敌世界观设定',
                npcs: [],
                characters: []
            }
        ];
        this.renderWorldBookList();
    }

    /**
     * 保存妈咪设置
     */
    saveMammySettings() {
        // 获取表单最新值
        const nickname = document.getElementById('mammy-nickname').value;
        const avatar = document.getElementById('mammy-avatar').value;
        const wallpaper = document.getElementById('mammy-wallpaper').value;
        const wallpaperOpacity = document.getElementById('mammy-wallpaper-opacity').value;
        const theme = document.getElementById('mammy-theme').value;
        const selfSetting = document.getElementById('mammy-self-setting')?.value || '';
        const apiUrl = document.getElementById('mammy-api-url').value;
        const apiKey = document.getElementById('mammy-api-key').value;
        const modelName = document.getElementById('mammy-model-name').value;
        const patStyle = document.getElementById('mammy-pat-style').value;
        // 更新设置对象
        this.mammySettings.nickname = nickname;
        this.mammySettings.patStyle = patStyle;
        this.mammySettings.avatar = avatar;
        this.mammySettings.wallpaper = wallpaper;
        this.mammySettings.wallpaperOpacity = parseInt(wallpaperOpacity);
        this.mammySettings.theme = theme;
        this.mammySettings.selfSetting = selfSetting;
        // API URL 自动补全：如果用户只填写了基础 URL，自动补全 /v1/chat/completions
        let fullApiUrl = apiUrl;
        if (fullApiUrl && !fullApiUrl.endsWith('/v1/chat/completions')) {
            // 移除末尾的斜杠，然后拼接标准路径
            fullApiUrl = fullApiUrl.replace(/\/+$/, '');
            fullApiUrl += '/v1/chat/completions';
        }
        this.mammySettings.apiUrl = fullApiUrl;
        this.mammySettings.apiKey = apiKey;
        this.mammySettings.modelName = modelName;

        // 保存全局气泡样式
        this.mammySettings.bubbleShape = document.getElementById('global-bubble-shape')?.value || 'rounded';
        this.mammySettings.bubbleBgColor = document.getElementById('global-bubble-bg-color')?.value || '#e9ecef';
        this.mammySettings.bubblePattern = document.getElementById('global-bubble-pattern')?.value || 'none';
        this.mammySettings.bubbleTextColor = document.getElementById('global-bubble-text-color')?.value || '#212529';
        // 保存全局字体大小
        const fontSize = document.getElementById('global-font-size').value;
        this.mammySettings.fontSize = parseInt(fontSize);
        // 保存字体样式
        const fontFamilySelect = document.getElementById('global-font-family');
        if (fontFamilySelect) {
            this.mammySettings.fontFamily = fontFamilySelect.value;
        }
        // 加粗和斜体状态已在点击时实时更新到 settings 对象中，无需额外读取
        // 保存消息合并延迟（转换为毫秒）
        const mergeDelay = document.getElementById('global-merge-delay')?.value || 3;
        this.mammySettings.messageMergeDelay = parseInt(mergeDelay) * 1000;
        // 保存自定义主题 - 将预览颜色保存到实际设置
        if (theme === 'custom' && this.previewTheme) {
            this.mammySettings.themeCustom = {...this.previewTheme};
        }
        // 保存自动生成设置
        this.saveAutoGenerateSettings();
        // 保存到 localStorage
        localStorage.setItem('mammySettings', JSON.stringify(this.mammySettings));
        console.log('Saved mammySettings to localStorage:', this.mammySettings);
        // 立即应用
        this.applyMammySettings();
        // 立即刷新当前聊天窗口的气泡样式
        if (this.currentChat) {
            this.applyBubbleStyle(this.currentChat);
        }
        // 同步论坛数据中妈咪的显示名称和头像
        const authorChat = this.getChat('user_mummy');
        if (authorChat) {
            authorChat.nickname = nickname;
            authorChat.avatar = avatar;
            this.saveChats();
            this.renderForum();
        }
        this.showNotification('设置已保存');

        // 立即应用全局气泡样式到当前聊天窗口
        if (this.currentChat) {
            // 强制使用全局气泡样式刷新当前聊天
            this.currentChat.bubbleShape = this.mammySettings.bubbleShape;
            this.currentChat.bubbleBgColor = this.mammySettings.bubbleBgColor;
            this.currentChat.bubblePattern = this.mammySettings.bubblePattern;
            this.currentChat.bubbleTextColor = this.mammySettings.bubbleTextColor;
            this.applyBubbleStyle(this.currentChat);
        }
    }

    /**
     * 渲染写手模板库
     */
    renderWriterTemplates() {
        const container = document.getElementById('writer-templates-manager');
        if (!container) return;

        const templates = this.mammySettings.writerTemplates || [];
        if (templates.length === 0) {
            container.innerHTML = '<p class="empty-templates">暂无模板，点击"添加模板"开始创建</p>';
            return;
        }

        container.innerHTML = templates.map(template => {
            const preview = template.prompt.length > 50 ? template.prompt.substring(0, 50) + '...' : template.prompt;
            const lengthText = template.outputLength === 'short' ? '短' : template.outputLength === 'medium' ? '中' : '长';
            return `
                <div class="writer-template-item">
                    <div class="template-header">
                        <h5>${template.name}</h5>
                        <div class="template-actions">
                            <button class="edit-btn" onclick="chatManager.editWriterTemplate('${template.id}')">✏️</button>
                            <button class="delete-btn" onclick="chatManager.deleteWriterTemplate('${template.id}')">🗑️</button>
                        </div>
                    </div>
                    <div class="template-preview">${preview}</div>
                    <div class="template-length">输出长度: ${lengthText}</div>
                </div>
            `;
        }).join('');
    }

    /**
     * 添加写手模板
     */
    addWriterTemplate() {
        const modal = document.getElementById('writer-template-modal');
        const title = document.getElementById('writer-template-modal-title');
        if (modal && title) {
            title.textContent = '添加写手模板';
            modal.classList.add('active');
            // 清空表单
            document.getElementById('writer-template-name').value = '';
            document.getElementById('writer-template-prompt').value = '';
            document.getElementById('writer-template-length').value = 'medium';
        }
    }

    /**
     * 编辑写手模板
     */
    editWriterTemplate(id) {
        const templates = this.mammySettings.writerTemplates || [];
        const template = templates.find(t => t.id === id);
        if (!template) return;

        const modal = document.getElementById('writer-template-modal');
        const title = document.getElementById('writer-template-modal-title');
        if (modal && title) {
            title.textContent = '编辑写手模板';
            modal.classList.add('active');
            // 填充表单
            document.getElementById('writer-template-name').value = template.name;
            document.getElementById('writer-template-prompt').value = template.prompt;
            document.getElementById('writer-template-length').value = template.outputLength;
            // 保存时更新而不是添加
            modal.dataset.editingId = id;
        }
    }

    closeWriterTemplateModal() {
        const modal = document.getElementById('writer-template-modal');
        if (modal) {
            modal.classList.remove('active');
            delete modal.dataset.editingId;
        }
    }

    saveWriterTemplate() {
        const modal = document.getElementById('writer-template-modal');
        const name = document.getElementById('writer-template-name').value.trim();
        const prompt = document.getElementById('writer-template-prompt').value.trim();
        const length = document.getElementById('writer-template-length').value;

        if (!name || !prompt) {
            this.showNotification('请填写模板名称和提示词！');
            return;
        }

        const editingId = modal.dataset.editingId;
        const templates = this.mammySettings.writerTemplates || [];

        if (editingId) {
            // 编辑模式
            const template = templates.find(t => t.id === editingId);
            if (template) {
                template.name = name;
                template.prompt = prompt;
                template.outputLength = length;
            }
        } else {
            // 添加模式
            const template = {
                id: `template_${Date.now()}`,
                name: name,
                prompt: prompt,
                outputLength: length
            };
            templates.push(template);
        }

        localStorage.setItem('mammySettings', JSON.stringify(this.mammySettings));
        this.renderWriterTemplates();
        this.closeWriterTemplateModal();
        this.showNotification(editingId ? '模板编辑成功' : '模板添加成功');
    }

    /**
     * 删除写手模板
     */
    deleteWriterTemplate(id) {
        if (!confirm('确定要删除这个模板吗？')) return;

        const templates = this.mammySettings.writerTemplates || [];
        const index = templates.findIndex(t => t.id === id);
        if (index > -1) {
            templates.splice(index, 1);
            localStorage.setItem('mammySettings', JSON.stringify(this.mammySettings));
            this.renderWriterTemplates();
            this.showNotification('模板删除成功');
        }
    }

    /**
     * 构建论坛生成提示词
     */
    buildPromptForForumPost(roleType, roleData, topic) {
        if (roleType === 'oc') {
            return {
                systemPrompt: roleData.personalityPrompt,
                userPrompt: `请以你的身份在论坛发一篇帖子，主题是${topic}，语气要符合你的性格。`,
                maxTokens: 200
            };
        } else if (roleType === 'writer') {
            const templates = this.mammySettings.writerTemplates || [];
            if (templates.length === 0) return null;
            const template = templates[Math.floor(Math.random() * templates.length)];
            let maxTokens = 150;
            if (template.outputLength === 'medium') maxTokens = 300;
            if (template.outputLength === 'long') maxTokens = 500;
            return {
                systemPrompt: template.prompt,
                userPrompt: `请写一篇关于${topic}的同人短文，风格要符合你的设定。`,
                maxTokens: maxTokens
            };
        } else if (roleType === 'fixedNPC') {
            return {
                systemPrompt: roleData.setting,
                userPrompt: `请以你的身份在论坛发一篇帖子，主题是${topic}。`,
                maxTokens: 100
            };
        } else {
            return {
                systemPrompt: "你是一个普通论坛用户，说话简短。",
                userPrompt: `请发一条关于${topic}的简短评论。`,
                maxTokens: 50
            };
        }
    }

    /**
     * 应用妈咪设置
     */
    applyMammySettings() {
        if (!this.mammySettings) this.loadMammySettings();
        try {
            const settings = this.mammySettings;
            console.log('Applying mammy settings:', settings);
        // 更新左上角头像
        const avatarEl = document.querySelector('.header .avatar span');
        if (avatarEl) {
            if (settings.avatar && (settings.avatar.startsWith('http://') || settings.avatar.startsWith('https://'))) {
                avatarEl.innerHTML = `<img src="${settings.avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
            } else {
                avatarEl.textContent = settings.avatar || '👤';
            }
        }

        // 应用全局字体大小到 body
        if (settings.fontSize) {
            document.body.style.fontSize = settings.fontSize + 'px';
        }
        // 应用字体样式
        if (settings.fontFamily) {
            document.body.style.fontFamily = settings.fontFamily;
        }
        if (settings.fontWeight) {
            document.body.style.fontWeight = settings.fontWeight;
        }
        if (settings.fontStyle) {
            document.body.style.fontStyle = settings.fontStyle;
        }
        // 更新主页面壁纸
        const container = document.querySelector('.phone-container');
        const content = document.querySelector('.content');
        const pages = document.querySelectorAll('.page');
        // 确保所有列表容器背景透明
        const chatList = document.querySelector('.chat-list');
        const postList = document.querySelectorAll('.post-list');
        const contactList = document.querySelector('.contact-list');

        // 应用壁纸和透明度
        if (settings.wallpaper && settings.wallpaper.trim() !== '') {
            if (container) {
                // 调试输出
                console.log('Setting wallpaper:', settings.wallpaper, 'opacity:', settings.wallpaperOpacity);
                // 设置壁纸URL变量供伪元素使用，用双引号包裹URL
                container.style.setProperty('--wallpaper-url', `url("${settings.wallpaper}")`);
                // 应用壁纸透明度，默认1（完全不透明）
                let opacity = 1;
                if (settings.wallpaperOpacity !== undefined && settings.wallpaperOpacity !== null) {
                    opacity = settings.wallpaperOpacity / 100;
                }
                // 确保透明度范围在 0-1 之间
                opacity = Math.min(1, Math.max(0, opacity));
                container.style.setProperty('--wallpaper-opacity', opacity);
                // 强制浏览器重绘，确保伪元素更新
                container.style.transform = 'translateZ(0)';
                setTimeout(() => { container.style.transform = ''; }, 0);
            }
        } else {
            if (container) {
                // 调试输出
                console.log('Clearing wallpaper');
                // 清除壁纸URL
                container.style.setProperty('--wallpaper-url', 'none');
                container.style.setProperty('--wallpaper-opacity', 0);
                // 强制浏览器重绘
                container.style.transform = 'translateZ(0)';
                setTimeout(() => { container.style.transform = ''; }, 0);
            }
        }
        // 确保所有层级背景透明，让壁纸透出
        if (content) {
            content.style.background = 'transparent';
        }
        pages.forEach(page => {
            page.style.background = 'transparent';
        });
        if (chatList) chatList.style.background = 'transparent';
        if (postList) postList.forEach(list => list.style.background = 'transparent');
        if (contactList) contactList.style.background = 'transparent';
        // 更新主题
        if (settings.theme) {
            document.documentElement.setAttribute('data-theme', settings.theme);
        }
        // 应用自定义主题
        if (settings.theme === 'custom' && settings.themeCustom) {
            this.applyCustomTheme(settings.themeCustom);
        }
        // 应用全局字体大小（移到 try 块内部）
        if (settings.fontSize) {
            document.documentElement.style.fontSize = settings.fontSize + 'px';
        } else {
            document.documentElement.style.fontSize = ''; // 恢复默认
        }
        } catch (error) {
            console.error('Error applying mammy settings:', error);
        }
    }

    applyCustomTheme(customTheme) {
        const root = document.documentElement;
        // 只应用当前需要的变量，避免污染预设主题
        const themeVariables = ['primary', 'primary-dark', 'header-bg', 'header-text', 'subheader-bg', 'subheader-text', 'bg-page', 'card-bg', 'text-primary', 'name-color', 'text-secondary', 'border', 'button-bg', 'button-text', 'input-bg', 'input-border', 'nav-bg', 'nav-text', 'nav-active', 'shadow', 'chat-bg'];
        themeVariables.forEach(key => {
            if (customTheme[key]) {
                root.style.setProperty(`--${key}`, customTheme[key]);
            }
        });
    }

    clearCustomTheme() {
        // 清除自定义主题，恢复预设主题效果
        const root = document.documentElement;
        // 重置为默认主题变量
        root.style.removeProperty('--primary');
        root.style.removeProperty('--primary-dark');
        root.style.removeProperty('--header-bg');
        root.style.removeProperty('--header-text');
        root.style.removeProperty('--subheader-bg');
        root.style.removeProperty('--subheader-text');
        root.style.removeProperty('--bg-page');
        root.style.removeProperty('--card-bg');
        root.style.removeProperty('--text-primary');
        root.style.removeProperty('--name-color');
        root.style.removeProperty('--text-secondary');
        root.style.removeProperty('--border');
        root.style.removeProperty('--button-bg');
        root.style.removeProperty('--button-text');
        root.style.removeProperty('--input-bg');
        root.style.removeProperty('--input-border');
        root.style.removeProperty('--nav-bg');
        root.style.removeProperty('--nav-text');
        root.style.removeProperty('--nav-active');
        root.style.removeProperty('--shadow');
        root.style.removeProperty('--chat-bg');
    }

    /**
     * 渲染妈咪设置界面
     */
    renderMammySettings() {
        try {
            const settings = this.mammySettings;
            // 个人设置
            const nicknameEl = document.getElementById('mammy-nickname');
            if (nicknameEl) nicknameEl.value = settings.nickname || '';

            const avatarEl = document.getElementById('mammy-avatar');
            if (avatarEl) avatarEl.value = settings.avatar || '';

            const wallpaperEl = document.getElementById('mammy-wallpaper');
            if (wallpaperEl) wallpaperEl.value = settings.wallpaper || '';

            const wallpaperOpacityEl = document.getElementById('mammy-wallpaper-opacity');
            if (wallpaperOpacityEl) wallpaperOpacityEl.value = settings.wallpaperOpacity !== undefined ? settings.wallpaperOpacity : 100;

            const opacityValueEl = document.getElementById('wallpaper-opacity-value');
            if (opacityValueEl) opacityValueEl.textContent = settings.wallpaperOpacity !== undefined ? settings.wallpaperOpacity : 100;

            const themeEl = document.getElementById('mammy-theme');
            if (themeEl) themeEl.value = settings.theme || 'default';

            // 绑定壁纸透明度滑块事件
        const wallpaperOpacitySlider = document.getElementById('mammy-wallpaper-opacity');
        if (wallpaperOpacitySlider) {
            // 使用 oninput 直接赋值，避免 replaceWith 的问题
            wallpaperOpacitySlider.oninput = (e) => {
                const value = e.target.value;
                console.log('Wallpaper opacity changed to:', value / 100);
                const valueDisplay = document.getElementById('wallpaper-opacity-value');
                if (valueDisplay) {
                    valueDisplay.textContent = value;
                }
                // 实时应用透明度到壁纸（只影响伪元素）
                const container = document.querySelector('.phone-container');
                if (container) {
                    container.style.setProperty('--wallpaper-opacity', value / 100);
                }
            };
        }
        const selfSettingEl = document.getElementById('mammy-self-setting');
        if (selfSettingEl) selfSettingEl.value = settings.selfSetting || '';

        // 拍一拍样式设置
        const patStyleEl = document.getElementById('mammy-pat-style');
        if (patStyleEl) patStyleEl.value = settings.patStyle || '拍了拍我的头';

        // 全局气泡样式设置
        const globalBubbleShape = document.getElementById('global-bubble-shape');
        if (globalBubbleShape) globalBubbleShape.value = settings.bubbleShape || 'rounded';
        const globalBubbleBgColor = document.getElementById('global-bubble-bg-color');
        if (globalBubbleBgColor) globalBubbleBgColor.value = settings.bubbleBgColor || '#e9ecef';
        const globalBubblePattern = document.getElementById('global-bubble-pattern');
        if (globalBubblePattern) globalBubblePattern.value = settings.bubblePattern || 'none';
        const globalBubbleTextColor = document.getElementById('global-bubble-text-color');
        if (globalBubbleTextColor) globalBubbleTextColor.value = settings.bubbleTextColor || '#212529';

        // 绑定全局气泡样式预览更新
        if (globalBubbleShape) globalBubbleShape.onchange = () => this.updateGlobalBubblePreview();
        if (globalBubbleBgColor) globalBubbleBgColor.oninput = () => this.updateGlobalBubblePreview();
        if (globalBubblePattern) globalBubblePattern.onchange = () => this.updateGlobalBubblePreview();
        if (globalBubbleTextColor) globalBubbleTextColor.oninput = () => this.updateGlobalBubblePreview();
        this.updateGlobalBubblePreview();

        // 绑定全局字体大小滑块
        const fontSizeSlider = document.getElementById('global-font-size');
        const fontSizeValue = document.getElementById('font-size-value');
        if (fontSizeSlider && fontSizeValue) {
            fontSizeSlider.value = settings.fontSize || 14;
            fontSizeValue.textContent = fontSizeSlider.value;
            fontSizeSlider.oninput = (e) => {
                const val = e.target.value;
                fontSizeValue.textContent = val;
                // 实时预览
                document.documentElement.style.fontSize = val + 'px';
            };
        }

        // 回显字体样式设置
        const fontFamilySelect = document.getElementById('global-font-family');
        if (fontFamilySelect) {
            fontFamilySelect.value = settings.fontFamily || 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        }

        const boldBtn = document.getElementById('global-font-bold');
        const italicBtn = document.getElementById('global-font-italic');

        // 更新按钮激活状态
        const updateStyleButtonState = () => {
            if (boldBtn) {
                const isBold = settings.fontWeight === 'bold' || settings.fontWeight === '700';
                boldBtn.style.background = isBold ? 'var(--primary)' : 'var(--card-bg)';
                boldBtn.style.color = isBold ? 'white' : 'var(--text-primary)';
            }
            if (italicBtn) {
                const isItalic = settings.fontStyle === 'italic';
                italicBtn.style.background = isItalic ? 'var(--primary)' : 'var(--card-bg)';
                italicBtn.style.color = isItalic ? 'white' : 'var(--text-primary)';
            }
        };
        updateStyleButtonState();

        // 绑定事件
        if (boldBtn) {
            boldBtn.onclick = () => {
                const current = settings.fontWeight;
                settings.fontWeight = (current === 'bold' || current === '700') ? 'normal' : 'bold';
                updateStyleButtonState();
                // 实时预览
                document.body.style.fontWeight = settings.fontWeight;
            };
        }
        if (italicBtn) {
            italicBtn.onclick = () => {
                settings.fontStyle = settings.fontStyle === 'italic' ? 'normal' : 'italic';
                updateStyleButtonState();
                document.body.style.fontStyle = settings.fontStyle;
            };
        }
        if (fontFamilySelect) {
            fontFamilySelect.onchange = (e) => {
                document.body.style.fontFamily = e.target.value;
            };
        }

        // 绑定消息合并延迟滑块
        const mergeDelaySlider = document.getElementById('global-merge-delay');
        const mergeDelayValue = document.getElementById('global-merge-delay-value');
        if (mergeDelaySlider && mergeDelayValue) {
            mergeDelaySlider.value = (settings.messageMergeDelay || 3000) / 1000;
            mergeDelayValue.textContent = mergeDelaySlider.value;
            mergeDelaySlider.oninput = (e) => {
                const val = e.target.value;
                mergeDelayValue.textContent = val;
            };
        }

        // API配置
        const apiUrlEl = document.getElementById('mammy-api-url');
        if (apiUrlEl) apiUrlEl.value = settings.apiUrl || '';

        const apiKeyEl = document.getElementById('mammy-api-key');
        if (apiKeyEl) apiKeyEl.value = settings.apiKey || '';

        const modelNameEl = document.getElementById('mammy-model-name');
        if (modelNameEl) modelNameEl.value = settings.modelName || '';

        // 表情管理
        this.renderEmotionsManager();
        // 自动生成设置（已移动到独立的 renderAutoGenerateSettings 方法）
        // 自定义主题设置
        this.renderCustomThemeSettings();
        // 绑定主题选择事件
        const themeSelectEl = document.getElementById('mammy-theme');
        if (themeSelectEl) {
            themeSelectEl.addEventListener('change', (e) => {
                const customSection = document.getElementById('custom-theme-section');
                if (e.target.value === 'custom') {
                    if (customSection) customSection.style.display = 'block';
                    // 应用当前自定义主题到页面
                    if (settings.themeCustom) {
                        this.applyCustomTheme(settings.themeCustom);
                    }
                } else {
                    if (customSection) customSection.style.display = 'none';
                    // 清除自定义主题效果，应用预设主题
                    this.clearCustomTheme();
                }
            });
        }
        } catch (error) {
            console.error('Error rendering mammy settings:', error);
        }
    }

    renderCustomThemeSettings() {
        const customSection = document.getElementById('custom-theme-section');
        const settings = this.mammySettings;
        if (settings.theme === 'custom') {
            customSection.style.display = 'block';
        } else {
            customSection.style.display = 'none';
        }
        // 临时存储预览颜色，不影响实际设置
        this.previewTheme = {...settings.themeCustom};

        // 绑定颜色选择器事件 - 仅更新预览，不立即应用到页面
        const colorInputs = ['text-primary', 'name-color', 'text-secondary', 'button-bg', 'button-text', 'header-bg', 'header-text', 'subheader-bg', 'subheader-text', 'nav-bg', 'nav-text', 'nav-active', 'card-bg', 'border'];
        colorInputs.forEach(key => {
            const input = document.getElementById(`custom-${key}`);
            if (input) {
                input.value = this.previewTheme?.[key] || settings.themeCustom?.[key] || this.getDefaultThemeColor(key);
                input.addEventListener('input', (e) => {
                    if (!this.previewTheme) this.previewTheme = {};
                    this.previewTheme[key] = e.target.value;
                    this.updateThemePreview(); // 只更新预览，不应用到页面
                });
            }
        });
        this.updateThemePreview();
    }

    updateThemePreview() {
        const canvas = document.getElementById('theme-preview-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const settings = this.mammySettings;

        // 清空画布
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 绘制手机轮廓
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.strokeRect(10, 10, 180, 280);

        // 获取当前颜色值（优先使用预览颜色）
        const colors = {
            'text-primary': this.previewTheme?.['text-primary'] || settings.themeCustom?.['text-primary'] || '#212529',
            'name-color': this.previewTheme?.['name-color'] || settings.themeCustom?.['name-color'] || '#212529',
            'text-secondary': this.previewTheme?.['text-secondary'] || settings.themeCustom?.['text-secondary'] || '#6c757d',
            'button-bg': this.previewTheme?.['button-bg'] || settings.themeCustom?.['button-bg'] || '#667eea',
            'button-text': this.previewTheme?.['button-text'] || settings.themeCustom?.['button-text'] || '#ffffff',
            'header-bg': this.previewTheme?.['header-bg'] || settings.themeCustom?.['header-bg'] || '#667eea',
            'header-text': this.previewTheme?.['header-text'] || settings.themeCustom?.['header-text'] || '#ffffff',
            'subheader-bg': this.previewTheme?.['subheader-bg'] || settings.themeCustom?.['subheader-bg'] || '#667eea',
            'subheader-text': this.previewTheme?.['subheader-text'] || settings.themeCustom?.['subheader-text'] || '#ffffff',
            'nav-bg': this.previewTheme?.['nav-bg'] || settings.themeCustom?.['nav-bg'] || '#ffffff',
            'nav-text': this.previewTheme?.['nav-text'] || settings.themeCustom?.['nav-text'] || '#6c757d',
            'nav-active': this.previewTheme?.['nav-active'] || settings.themeCustom?.['nav-active'] || '#667eea',
            'card-bg': this.previewTheme?.['card-bg'] || settings.themeCustom?.['card-bg'] || '#ffffff',
            'border': this.previewTheme?.['border'] || settings.themeCustom?.['border'] || '#e9ecef'
        };

        // 绘制主表头
        ctx.fillStyle = colors['header-bg'];
        ctx.fillRect(10, 10, 180, 30);
        ctx.fillStyle = colors['header-text'];
        ctx.font = '12px Arial';
        ctx.fillText('主表头', 20, 30);

        // 绘制副表头（妈咪中心/聊天窗口顶部）
        ctx.fillStyle = colors['subheader-bg'];
        ctx.fillRect(10, 45, 180, 25);
        ctx.fillStyle = colors['subheader-text'];
        ctx.font = '11px Arial';
        ctx.fillText('副表头', 20, 62);

        // 绘制内容区域
        ctx.fillStyle = colors['card-bg'];
        ctx.fillRect(10, 75, 180, 150);
        ctx.fillStyle = colors['text-primary'];
        ctx.font = '10px Arial';
        ctx.fillText('主内容区域', 20, 100);
        ctx.fillStyle = colors['name-color'];
        ctx.fillText('OC名字示例', 20, 120);
        ctx.fillStyle = colors['text-secondary'];
        ctx.fillText('辅助文字', 20, 140);

        // 绘制按钮
        ctx.fillStyle = colors['button-bg'];
        ctx.fillRect(20, 160, 60, 20);
        ctx.fillStyle = colors['button-text'];
        ctx.font = '10px Arial';
        ctx.fillText('按钮', 35, 173);

        // 绘制底部导航
        ctx.fillStyle = colors['nav-bg'];
        ctx.fillRect(10, 245, 180, 45);
        ctx.fillStyle = colors['border'];
        ctx.fillRect(10, 245, 180, 1);

        // 绘制导航项
        const navItems = ['消息', '论坛', '联系人', '动态'];
        navItems.forEach((item, index) => {
            const x = 15 + index * 45;
            ctx.fillStyle = colors['nav-text'];
            ctx.font = '10px Arial';
            ctx.fillText(item, x, 260);
        });

        // 激活项
        ctx.fillStyle = colors['nav-active'];
        ctx.fillText('消息', 15, 260);
    }

    getDefaultThemeColor(key) {
        const defaults = {
            'text-primary': '#212529',
            'text-secondary': '#6c757d',
            'button-bg': '#667eea',
            'button-text': '#ffffff',
            'header-bg': '#667eea',
            'header-text': '#ffffff',
            'nav-bg': '#ffffff',
            'nav-active': '#667eea',
            'card-bg': '#ffffff',
            'border': '#e9ecef'
        };
        return defaults[key] || '#000000';
    }

    /**
     * 渲染自动生成设置界面
     */
    renderAutoGenerateSettings() {
        // 获取所有单人聊天角色（排除妈咪）
        const ocList = this.contacts.filter(c => !c.isGroup && c.id !== 'user_mummy');

        // 动态部分 OC 列表
        const dynamicsContainer = document.getElementById('dynamics-oc-list');
        if (dynamicsContainer) {
            const dynamicsFreq = this.mammySettings.autoGenerate.dynamics.ocFrequencies || {};
            dynamicsContainer.innerHTML = `<div class="freq-info">动态生成频率（0-10，值越高越频繁）</div>` + ocList.map(oc => {
                const chat = this.getChat(oc.id);
                const name = chat?.name || chat?.remarkName || chat?.nickname || oc.name;
                const freq = dynamicsFreq[oc.id] ?? 0;
                return `
                    <div class="oc-freq-item">
                        <span>${name}</span>
                        <input type="range" data-oc-id="${oc.id}" data-type="dynamics" min="0" max="10" step="1" value="${freq}">
                        <span class="freq-value">${freq}</span>
                    </div>
                `;
            }).join('');

            // 绑定滑块事件，实时更新显示数值
            dynamicsContainer.querySelectorAll('input[type="range"]').forEach(slider => {
                const valueSpan = slider.parentElement.querySelector('.freq-value');
                if (valueSpan) {
                    slider.addEventListener('input', () => { valueSpan.textContent = slider.value; });
                }
            });

        // 转发频率独立区域
        const forwardOcContainer = document.getElementById('forward-oc-list');
        if (forwardOcContainer) {
            const forwardFreq = this.mammySettings.autoGenerate.dynamics.ocForwardFrequencies || {};
            forwardOcContainer.innerHTML = ocList.map(oc => {
                const chat = this.getChat(oc.id);
                const name = chat?.name || chat?.remarkName || chat?.nickname || oc.name;
                const freq = forwardFreq[oc.id] ?? 3;
                return `
                    <div class="oc-freq-item">
                        <span>${name}</span>
                        <input type="range" data-oc-id="${oc.id}" data-type="forward" min="0" max="10" step="1" value="${freq}">
                        <span class="freq-value">${freq}</span>
                    </div>
                `;
            }).join('');

            // 绑定滑块事件
            forwardOcContainer.querySelectorAll('input[type="range"]').forEach(slider => {
                const valueSpan = slider.parentElement.querySelector('.freq-value');
                if (valueSpan) {
                    slider.addEventListener('input', () => { valueSpan.textContent = slider.value; });
                }
            });
        }
        }

        // 论坛部分 OC 列表
        const forumOcContainer = document.getElementById('forum-oc-list');
        if (forumOcContainer) {
            const forumFreq = this.mammySettings.autoGenerate.forum.ocFrequencies || {};
            const forumPostCounts = this.mammySettings.autoGenerate.forum.ocPostCounts || {};
            forumOcContainer.innerHTML = `<div class="freq-info">频率（0-10，值越高越频繁）</div>` + ocList.map(oc => {
                const chat = this.getChat(oc.id);
                const name = chat?.name || chat?.remarkName || chat?.nickname || oc.name;
                const freq = forumFreq[oc.id] ?? 0;
                const postCount = forumPostCounts[oc.id] ?? 1;
                return `
                    <div class="oc-freq-item" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px;">
                        <span style="min-width: 60px;">${name}</span>
                        <input type="range" data-oc-id="${oc.id}" data-type="forum" min="0" max="10" step="1" value="${freq}" style="flex: 1; min-width: 80px;">
                        <span class="freq-value" style="min-width: 20px;">${freq}</span>
                        <span style="font-size: 12px;">篇数:</span>
                        <input type="number" data-oc-id="${oc.id}" data-type="forum-count" min="1" max="5" value="${postCount}" style="width: 50px; padding: 2px; text-align: center;">
                    </div>
                `;
            }).join('');

            forumOcContainer.querySelectorAll('input[type="range"]').forEach(slider => {
                const valueSpan = slider.parentElement.querySelector('.freq-value');
                if (valueSpan) {
                    slider.addEventListener('input', () => { valueSpan.textContent = slider.value; });
                }
            });
        }

        // 固定 NPC 频率滑块
        const fixedNPCFreq = document.getElementById('auto-fixed-npc-freq');
        if (fixedNPCFreq) {
            fixedNPCFreq.value = this.mammySettings.autoGenerate.forum.fixedNPCFreq || 0;
            const valueSpan = fixedNPCFreq.parentElement?.querySelector('.freq-value');
            if (valueSpan) {
                valueSpan.textContent = fixedNPCFreq.value;
                fixedNPCFreq.oninput = () => { valueSpan.textContent = fixedNPCFreq.value; };
            }
        }

        // 同人太太频率滑块
        const writerFreq = document.getElementById('auto-writer-freq');
        if (writerFreq) {
            writerFreq.value = this.mammySettings.autoGenerate.forum.writerFreq || 0;
            const valueSpan = writerFreq.parentElement?.querySelector('.freq-value');
            if (valueSpan) {
                valueSpan.textContent = writerFreq.value;
                writerFreq.oninput = () => { valueSpan.textContent = writerFreq.value; };
            }
        }

        // 路人 NPC 频率滑块
        const randomNPCFreq = document.getElementById('auto-random-npc-freq');
        if (randomNPCFreq) {
            randomNPCFreq.value = this.mammySettings.autoGenerate.forum.randomNPCFreq || 0;
            const valueSpan = randomNPCFreq.parentElement?.querySelector('.freq-value');
            if (valueSpan) {
                valueSpan.textContent = randomNPCFreq.value;
                randomNPCFreq.oninput = () => { valueSpan.textContent = randomNPCFreq.value; };
            }
        }

        // 开关状态
        const dynamicsSwitch = document.getElementById('auto-dynamics-switch');
        if (dynamicsSwitch) dynamicsSwitch.checked = this.mammySettings.autoGenerate.dynamics.enabled || false;

        // 回显动态生成间隔设置
        const dynamicsInterval = document.getElementById('auto-dynamics-interval');
        if (dynamicsInterval) {
            dynamicsInterval.value = this.mammySettings.autoGenerate.dynamics.intervalValue ?? 30;
        }
        const dynamicsUnit = document.getElementById('auto-dynamics-unit');
        if (dynamicsUnit) {
            dynamicsUnit.value = this.mammySettings.autoGenerate.dynamics.intervalUnit ?? 'minute';
        }

        const forumSwitch = document.getElementById('auto-forum-switch');
        if (forumSwitch) forumSwitch.checked = this.mammySettings.autoGenerate.forum.enabled || false;

        // 回显论坛生成间隔设置
        const forumInterval = document.getElementById('auto-forum-interval');
        if (forumInterval) {
            forumInterval.value = this.mammySettings.autoGenerate.forum.intervalValue ?? 30;
        }
        const forumUnit = document.getElementById('auto-forum-unit');
        if (forumUnit) {
            forumUnit.value = this.mammySettings.autoGenerate.forum.intervalUnit ?? 'minute';
        }

        const hotTagsSwitch = document.getElementById('auto-hot-tags-switch');
        if (hotTagsSwitch) hotTagsSwitch.checked = this.mammySettings.autoGenerate.hotTags.enabled || false;

        // 上下文记忆条数
        const contextLengthSlider = document.getElementById('context-length');
        if (contextLengthSlider) {
            contextLengthSlider.value = this.mammySettings.autoGenerate.contextLength || 10;
            const contextLengthValue = document.getElementById('context-length-value');
            if (contextLengthValue) contextLengthValue.textContent = contextLengthSlider.value;
            contextLengthSlider.oninput = (e) => {
                if (contextLengthValue) contextLengthValue.textContent = e.target.value;
            };
        }

        // 回显论坛热闹度设置
        const commentMinEl = document.getElementById('forum-comment-min');
        const commentMaxEl = document.getElementById('forum-comment-max');
        const commentTempEl = document.getElementById('forum-comment-temperature');
        const commentTempValue = document.getElementById('forum-comment-temperature-value');
        const likeMinEl = document.getElementById('forum-like-min');
        const likeMaxEl = document.getElementById('forum-like-max');

        if (commentMinEl) commentMinEl.value = this.mammySettings.autoGenerate.forum.commentMin ?? 3;
        if (commentMaxEl) commentMaxEl.value = this.mammySettings.autoGenerate.forum.commentMax ?? 6;
        if (commentTempEl) {
            commentTempEl.value = this.mammySettings.autoGenerate.forum.commentTemperature ?? 0.9;
            if (commentTempValue) commentTempValue.textContent = commentTempEl.value;
            commentTempEl.oninput = (e) => {
                if (commentTempValue) commentTempValue.textContent = e.target.value;
            };
        }
        if (likeMinEl) likeMinEl.value = this.mammySettings.autoGenerate.forum.likeMin ?? 2;
        if (likeMaxEl) likeMaxEl.value = this.mammySettings.autoGenerate.forum.likeMax ?? 5;
    }

    /**
     * 保存自动生成设置
     */
    saveAutoGenerateSettings() {
        // 收集动态 OC 频率
        const allSliders = document.querySelectorAll('#dynamics-oc-list input[type="range"]');
        const dynamicsOcFreq = {};
        allSliders.forEach(slider => {
            const ocId = slider.getAttribute('data-oc-id');
            const type = slider.getAttribute('data-type');
            const value = parseInt(slider.value);
            if (type === 'dynamics') {
                dynamicsOcFreq[ocId] = value;
            }
        });
        this.mammySettings.autoGenerate.dynamics.ocFrequencies = dynamicsOcFreq;

        // 收集转发频率
        const forwardSliders = document.querySelectorAll('#forward-oc-list input[type="range"]');
        const forwardOcFreq = {};
        forwardSliders.forEach(slider => {
            const ocId = slider.getAttribute('data-oc-id');
            forwardOcFreq[ocId] = parseInt(slider.value);
        });
        this.mammySettings.autoGenerate.dynamics.ocForwardFrequencies = forwardOcFreq;
        // 收集论坛 OC 频率
        const forumSliders = document.querySelectorAll('#forum-oc-list input[type="range"]');
        const forumOcFreq = {};
        forumSliders.forEach(slider => {
            const ocId = slider.getAttribute('data-oc-id');
            forumOcFreq[ocId] = parseInt(slider.value);
        });
        this.mammySettings.autoGenerate.forum.ocFrequencies = forumOcFreq;
        // 保存 OC 每次发帖篇数
        const forumCountInputs = document.querySelectorAll('#forum-oc-list input[type="number"]');
        const forumOcPostCounts = {};
        forumCountInputs.forEach(input => {
            const ocId = input.getAttribute('data-oc-id');
            forumOcPostCounts[ocId] = parseInt(input.value) || 1;
        });
        this.mammySettings.autoGenerate.forum.ocPostCounts = forumOcPostCounts;
        // 其他滑块
        this.mammySettings.autoGenerate.forum.fixedNPCFreq = parseInt(document.getElementById('auto-fixed-npc-freq').value);
        this.mammySettings.autoGenerate.forum.fixedNPCCount = parseInt(document.getElementById('auto-fixed-npc-count')?.value) || 1;
        this.mammySettings.autoGenerate.forum.writerFreq = parseInt(document.getElementById('auto-writer-freq').value);
        this.mammySettings.autoGenerate.forum.writerCount = parseInt(document.getElementById('auto-writer-count')?.value) || 1;
        this.mammySettings.autoGenerate.forum.randomNPCFreq = parseInt(document.getElementById('auto-random-npc-freq').value);
        this.mammySettings.autoGenerate.forum.randomNPCCount = parseInt(document.getElementById('auto-random-npc-count')?.value) || 1;
        // 开关
        this.mammySettings.autoGenerate.dynamics.enabled = document.getElementById('auto-dynamics-switch').checked;
        // 保存动态生成间隔设置
        const dynamicsInterval = document.getElementById('auto-dynamics-interval');
        if (dynamicsInterval) {
            this.mammySettings.autoGenerate.dynamics.intervalValue = parseInt(dynamicsInterval.value) || 30;
        }
        const dynamicsUnit = document.getElementById('auto-dynamics-unit');
        if (dynamicsUnit) {
            this.mammySettings.autoGenerate.dynamics.intervalUnit = dynamicsUnit.value;
        }
        // 保存论坛生成间隔设置
        const forumInterval = document.getElementById('auto-forum-interval');
        if (forumInterval) {
            this.mammySettings.autoGenerate.forum.intervalValue = parseInt(forumInterval.value) || 30;
        }
        const forumUnit = document.getElementById('auto-forum-unit');
        if (forumUnit) {
            this.mammySettings.autoGenerate.forum.intervalUnit = forumUnit.value;
        }
        this.mammySettings.autoGenerate.forum.enabled = document.getElementById('auto-forum-switch').checked;
        // 保存论坛热闹度设置
        this.mammySettings.autoGenerate.forum.commentMin = parseInt(document.getElementById('forum-comment-min').value) || 3;
        this.mammySettings.autoGenerate.forum.commentMax = parseInt(document.getElementById('forum-comment-max').value) || 6;
        this.mammySettings.autoGenerate.forum.commentTemperature = parseFloat(document.getElementById('forum-comment-temperature').value) || 0.9;
        this.mammySettings.autoGenerate.forum.likeMin = parseInt(document.getElementById('forum-like-min').value) || 2;
        this.mammySettings.autoGenerate.forum.likeMax = parseInt(document.getElementById('forum-like-max').value) || 5;
        this.mammySettings.autoGenerate.forum.commentReactionFreq = parseInt(document.getElementById('auto-comment-reaction-freq').value) || 5;
        // 上下文记忆条数
        this.mammySettings.autoGenerate.contextLength = parseInt(document.getElementById('context-length').value);
        // 在保存设置后，根据开关状态启动/停止定时器
        if (this.mammySettings.autoGenerate.dynamics.enabled) {
            this.startAutoDynamicTimer();
        } else {
            this.stopAutoDynamicTimer();
        }
        // 论坛定时器
        if (this.mammySettings.autoGenerate.forum.enabled) {
            this.startAutoForumTimer();
        } else {
            this.stopAutoForumTimer();
        }

        // 保存后立即刷新自动生成设置面板的显示（确保滑块与存储值一致）
        this.renderAutoGenerateSettings();
    }

    /**
     * 渲染表情管理界面
     */
    renderEmotionsManager() {
        const container = document.getElementById('emotions-manager');
        if (!container) return;
        container.innerHTML = '';
        const emotions = this.mammySettings.emotions || {};
        for (const [group, items] of Object.entries(emotions)) {
            const groupEl = document.createElement('div');
            groupEl.className = 'emotion-group';
            groupEl.innerHTML = `
                <div class="group-header" style="display: flex; justify-content: space-between; align-items: center;">
                    <span>${group}</span>
                    <button class="delete-emotion-group-btn" onclick="chatManager.deleteEmotionGroup('${group}')">🗑️</button>
                </div>
                <button class="add-emotion-btn" onclick="chatManager.addEmotion('${group}')">➕</button>
                <div class="emotion-items-wrapper">
                    <div class="emotion-items">${items.map(emoji => {
                        const isUrl = emoji.startsWith('http://') || emoji.startsWith('https://') || emoji.startsWith('data:image');
                        const content = isUrl ? `<img src="${emoji}" style="width: 30px; height: 30px; object-fit: contain;">` : emoji;
                        return `<span class="emotion-item">${content}
                            <button class="delete-emotion-btn" onclick="chatManager.deleteEmotion('${group}', '${emoji}')">✕</button>
                        </span>`;
                    }).join('')}</div>
                </div>
            `;
            container.appendChild(groupEl);
        }
    }

    /**
     * 添加表情
     */
    addEmotion(group) {
        // 创建自定义弹窗
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.style.zIndex = '3000';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 350px; margin: 20px;">
                <div class="modal-header">
                    <h3>添加表情</h3>
                    <button class="close-btn" onclick="this.closest('.modal').remove()">✕</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>表情（emoji或图片URL）</label>
                        <input type="text" id="emotion-input" placeholder="输入emoji字符或图片URL" style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 4px;">
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="cancel-btn" onclick="this.closest('.modal').remove()">取消</button>
                    <button class="submit-btn" onclick="chatManager.confirmAddEmotion('${group}', this.closest('.modal'))">确认</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // 聚焦输入框
        const input = modal.querySelector('#emotion-input');
        if (input) input.focus();
    }

    confirmAddEmotion(group, modal) {
        const input = modal.querySelector('#emotion-input');
        const newEmoji = input.value.trim();
        if (newEmoji) {
            if (!this.mammySettings.emotions[group]) {
                this.mammySettings.emotions[group] = [];
            }
            this.mammySettings.emotions[group].push(newEmoji);
            this.saveMammySettings();
            this.renderEmotionsManager();
        }
        modal.remove();
    }

    /**
     * 删除表情
     */
    deleteEmotion(group, emoji) {
        const index = this.mammySettings.emotions[group].indexOf(emoji);
        if (index > -1) {
            this.mammySettings.emotions[group].splice(index, 1);
            this.saveMammySettings();
            this.renderEmotionsManager();
        }
    }

    /**
     * 显示选择表情分组模态框（替代原来的 prompt）
     */
    addEmotionGroup() {
        // 获取所有预定义的情绪词列表
        const predefinedEmotions = this.getPredefinedEmotionKeys();

        // 过滤掉已经存在的分组
        const existingGroups = Object.keys(this.mammySettings.emotions || {});
        const availableOptions = predefinedEmotions.filter(emotion => !existingGroups.includes(emotion));

        if (availableOptions.length === 0) {
            this.showNotification('所有预定义情绪分组都已存在，无法添加更多');
            return;
        }

        // 填充下拉框
        const select = document.getElementById('emotion-group-select');
        if (select) {
            select.innerHTML = availableOptions.map(emotion => {
                const displayName = this.getEmotionCategoryName(emotion);
                return `<option value="${emotion}">${displayName} (${emotion})</option>`;
            }).join('');
        }

        // 显示模态框
        const modal = document.getElementById('select-emotion-group-modal');
        if (modal) modal.classList.add('active');
    }

    /**
     * 关闭选择表情分组模态框
     */
    closeSelectEmotionGroupModal() {
        const modal = document.getElementById('select-emotion-group-modal');
        if (modal) modal.classList.remove('active');
    }

    /**
     * 确认添加选中的表情分组
     */
    confirmSelectEmotionGroup() {
        const select = document.getElementById('emotion-group-select');
        const selectedEmotion = select.value;
        if (!selectedEmotion) return;

        // 添加新分组（空数组）
        if (!this.mammySettings.emotions) this.mammySettings.emotions = {};
        if (!this.mammySettings.emotions[selectedEmotion]) {
            this.mammySettings.emotions[selectedEmotion] = [];
            this.saveMammySettings();
            this.renderEmotionsManager(); // 刷新表情管理界面
            this.showNotification(`已添加分组：${this.getEmotionCategoryName(selectedEmotion)}`);
        } else {
            this.showNotification('该分组已存在');
        }

        this.closeSelectEmotionGroupModal();
    }

    /**
     * 获取预定义的情绪词列表
     */
    getPredefinedEmotionKeys() {
        const names = {
            'happy': '开心', 'sad': '伤心', 'angry': '愤怒', 'surprised': '惊讶',
            'excited': '兴奋', 'touched': '感动', 'lonely': '孤独', 'anxious': '焦虑',
            'proud': '自豪', 'embarrassed': '尴尬', 'frustrated': '挫败', 'nostalgic': '怀念',
            'calm': '平静', 'hopeful': '希望', 'jealous': '嫉妒', 'disappointed': '失望',
            'confused': '困惑', 'bored': '无聊', 'tired': '疲惫', 'energetic': '活力',
            'curious': '好奇', 'grateful': '感激', 'annoyed': '烦躁', 'scared': '害怕',
            'worried': '担心', 'relaxed': '放松', 'amused': '被逗乐', 'sympathetic': '同情',
            'shocked': '震惊', 'envious': '羡慕', 'betrayed': '背叛感', 'adored': '被宠爱',
            'rejected': '被拒绝', 'accepted': '被接纳', 'free': '自由', 'trapped': '受困',
            'peaceful': '安宁', 'restless': '不安'
        };
        return Object.keys(names);
    }

    /**
     * 切换选项卡
     */
    switchTab(tabName) {
        // 隐藏所有选项卡内容
        document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
        // 显示选中的选项卡内容
        document.getElementById(`${tabName}-tab`).classList.add('active');
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    }

    /**
     * 切换页面（用于导航栏点击）
     */
    switchPage(pageName) {
        // 切换页面前，清理所有可能残留的临时状态
        if (this.multiSelectMode) {
            this.exitMultiSelectMode();
        }
        this.closeBottomSheet();
        // 同时，如果引用了消息，也一并清除
        this.clearQuote();

        console.log('switchPage called:', pageName);
        const navItems = document.querySelectorAll('.nav-item');
        const pages = document.querySelectorAll('.page');

        // 移除所有活动状态
        navItems.forEach(nav => nav.classList.remove('active'));
        pages.forEach(page => page.classList.remove('active'));

        // 添加当前页的活动状态
        const activeNav = Array.from(navItems).find(nav => nav.getAttribute('data-page') === pageName);
        if (activeNav) activeNav.classList.add('active');

        const targetPageEl = document.getElementById(`${pageName}-page`);
        if (targetPageEl) {
            targetPageEl.classList.add('active');
            console.log('Page activated:', pageName);
        }

        if (pageName === 'message') {
            this.renderChatList();
        }
        // ✅ 添加这一行，确保联系人页面渲染
        if (pageName === 'contact') {
            this.renderContacts();
        }
        // ✅ 添加对动态页面的处理
        if (pageName === 'dynamic') {
            this.renderDynamics();
            this.bindDynamicButtons();
            this.setupInfiniteScroll('dynamic-list', 'dynamic');
            this.hideDynamicBadge();
        }

        // ✅ 添加对论坛页面的处理
        if (pageName === 'forum') {
            this.isSearchMode = false;
            this.searchResults = null;
            this.renderForum();
            this.setupInfiniteScroll('forum-list', 'forum');
            // 绑定热搜榜时间切换按钮事件
            document.querySelector('.hot-rank-tabs')?.addEventListener('click', (e) => {
                const tab = e.target.closest('.hot-rank-tab');
                if (!tab) return;
                const period = tab.dataset.period;
                this.renderHotRank(period);
            });
            this.hideForumBadge();
        }

        // 切换页面时隐藏回到顶部按钮
        const backToTopBtn = document.getElementById('back-to-top-btn');
        if (backToTopBtn) {
            backToTopBtn.classList.remove('show');
        }
    }

    /**
     * 获取可用模型列表
     */
    async fetchModels() {
        const apiUrl = document.getElementById('mammy-api-url').value.trim();
        const apiKey = document.getElementById('mammy-api-key').value.trim();
        if (!apiUrl || !apiKey) {
            this.showNotification('请先填写 API URL 和 API Key！');
            return;
        }
        let modelsUrl = apiUrl;
        if (modelsUrl.endsWith('/v1/chat/completions')) {
            modelsUrl = modelsUrl.replace('/v1/chat/completions', '/v1/models');
        } else {
            modelsUrl = modelsUrl.replace(/\/+$/, '');
            modelsUrl += '/v1/models';
        }
        try {
            const response = await fetch(modelsUrl, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            const data = await response.json();
            if (data.data && Array.isArray(data.data)) {
                const models = data.data.map(m => m.id).filter(id => id);
                if (models.length === 0) {
                    this.showNotification('未获取到可用模型');
                    return;
                }
                const container = document.getElementById('model-list-container');
                container.innerHTML = models.map(model => `
                    <div class="model-item" data-model="${model}" style="padding: 10px; border-bottom: 1px solid var(--border); cursor: pointer;">
                        ${model}
                    </div>
                `).join('');
                // 绑定点击事件
                container.querySelectorAll('.model-item').forEach(item => {
                    item.onclick = () => {
                        document.getElementById('mammy-model-name').value = item.dataset.model;
                        document.getElementById('model-select-modal').classList.remove('active');
                        this.showNotification('模型已选择');
                    };
                });
                document.getElementById('model-select-modal').classList.add('active');
            } else {
                this.showNotification('获取模型列表失败：返回格式异常');
            }
        } catch (error) {
            console.error(error);
            this.showNotification('获取模型列表失败：' + error.message);
        }
    }

    /**
     * 测试API连接
     */
    async testAPI() {
        const apiUrl = document.getElementById('mammy-api-url').value.trim();
        const apiKey = document.getElementById('mammy-api-key').value.trim();
        const model = document.getElementById('mammy-model-name').value.trim();
        const statusSpan = document.getElementById('api-test-status');
        const testBtn = document.getElementById('test-api-btn');

        if (!apiUrl || !apiKey || !model) {
            this.showNotification('请完整填写 API URL、Key 和模型名称！');
            return;
        }

        // 显示加载状态
        statusSpan.innerHTML = '<span class="loading-spinner" style="display: inline-block; width: 16px; height: 16px; border: 2px solid #f3f3f3; border-top: 2px solid #3498db; border-radius: 50%; animation: spin 1s linear infinite;"></span>';
        testBtn.disabled = true;

        // 创建加载动画
        const style = document.createElement('style');
        style.textContent = `
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);

        // 创建自定义模态框
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'api-test-result-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>API测试结果</h3>
                    <button class="close-btn" onclick="this.closest('.modal').classList.remove('active')">✕</button>
                </div>
                <div class="modal-body" id="api-test-result-body">
                    <p>测试中...</p>
                </div>
                <div class="modal-footer">
                    <button class="cancel-btn" onclick="this.closest('.modal').classList.remove('active')">关闭</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        setTimeout(async () => {
            try {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [{ role: 'user', content: '你好，请简单回复一句话测试连接是否成功。' }],
                                            })
                });

                const data = await response.json();

                if (data.choices && data.choices[0] && data.choices[0].message) {
                    const reply = data.choices[0].message.content;
                    statusSpan.innerHTML = '<span style="color: green;">✓</span>';
                    document.getElementById('api-test-result-body').innerHTML = `<p style="color: green;">连接成功！</p><p>AI回复：${reply}</p>`;
                    modal.classList.add('active');
                } else {
                    statusSpan.innerHTML = '<span style="color: red;">✗</span>';
                    document.getElementById('api-test-result-body').innerHTML = `<p style="color: red;">API 返回格式异常，请检查配置。</p><p>返回数据：${JSON.stringify(data)}</p>`;
                    modal.classList.add('active');
                }
            } catch (error) {
                console.error(error);
                statusSpan.innerHTML = '<span style="color: red;">✗</span>';
                document.getElementById('api-test-result-body').innerHTML = `<p style="color: red;">测试失败：${error.message}</p><p>请确保 API 支持 CORS 或使用后端代理。</p>`;
                modal.classList.add('active');
            } finally {
                testBtn.disabled = false;
                // 清理加载动画
                setTimeout(() => {
                    if (style.parentNode) style.parentNode.removeChild(style);
                }, 2000);
            }
        }, 500);
    }

    /**
     * 打开世界书编辑器
     */
    openWorldBookEditor(worldId) {
        this.currentWorldId = worldId;
        const world = this.worldBooks.find(w => w.id === worldId);
        const modal = document.getElementById('worldbook-modal');
        const title = document.getElementById('worldbook-modal-title');

        if (world) {
            document.getElementById('worldbook-name').value = world.name;
            document.getElementById('worldbook-desc').value = world.description || '';
            this.renderNPCList(world.npcs || []);
            title.textContent = `编辑: ${world.name}`;
        } else {
            document.getElementById('worldbook-name').value = '';
            document.getElementById('worldbook-desc').value = '';
            this.renderNPCList([]);
            title.textContent = '添加世界观';
        }

        if (modal) {
            modal.classList.add('active');
        }

        // 确保NPC列表默认收起
        const npcContainer = document.getElementById('npc-list-container');
        if (npcContainer) {
            npcContainer.style.display = 'none';
        }
    }

    /**
     * 关闭世界书编辑器
     */
    closeWorldBookEditor() {
        const modal = document.getElementById('worldbook-modal');
        if (modal) {
            modal.classList.remove('active');
        }
        this.currentWorldId = null;
        this.clearNPCForm();
    }

    closeWorldBookModal() {
        this.closeWorldBookEditor();
    }

    /**
     * 保存世界书
     */
    saveWorldBook() {
        const name = document.getElementById('worldbook-name').value.trim();
        const desc = document.getElementById('worldbook-desc').value.trim();
        if (!name) {
            this.showNotification('请输入世界观名称！');
            return;
        }
        let world = this.worldBooks.find(w => w.id === this.currentWorldId);
        if (!world) {
            world = {
                id: `world_${Date.now()}`,
                name: name,
                description: desc,
                npcs: [],
                characters: []
            };
            this.worldBooks.push(world);
        } else {
            world.name = name;
            world.description = desc;
        }
        localStorage.setItem('worldBooks', JSON.stringify(this.worldBooks));
        this.renderWorldBookList();
        this.closeWorldBookModal();
        this.showNotification('世界书已保存');
    }

    /**
     * 删除世界书
     */
    deleteWorldBook(worldId) {
        if (confirm('确定要删除这个世界观吗？')) {
            this.worldBooks = this.worldBooks.filter(w => w.id !== worldId);
            localStorage.setItem('worldBooks', JSON.stringify(this.worldBooks));
            this.renderWorldBookList();
            // 如果当前正在编辑这个，则关闭弹窗
            if (this.currentWorldId === worldId) {
                this.closeWorldBookModal();
            }
        }
    }

    /**
     * 渲染世界书列表
     */
    renderWorldBookList() {
        const container = document.getElementById('worldbook-list');
        if (!container) return;
        container.innerHTML = (this.worldBooks || []).map(world => `
            <div class="worldbook-item">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span>${world.name}</span>
                    <div>
                        <button class="edit-worldbook-btn" onclick="event.stopPropagation(); chatManager.openWorldBookEditor('${world.id}')">✏️</button>
                        <button class="delete-worldbook-btn" onclick="event.stopPropagation(); chatManager.deleteWorldBook('${world.id}')">🗑️</button>
                    </div>
                </div>
            </div>
        `).join('');
    }

    /**
     * 渲染NPC列表
     */
    renderNPCList(npcs) {
        const container = document.getElementById('npc-list');
        if (!container) return;
        container.innerHTML = npcs.map((npc, index) => {
            // 处理头像显示（URL或emoji）
            let avatarContent;
            if (npc.avatar && (npc.avatar.startsWith('http://') || npc.avatar.startsWith('https://'))) {
                avatarContent = `<img src="${npc.avatar}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span class="emoji-fallback" style="display: none;">👤</span>`;
            } else {
                avatarContent = `<span>${npc.avatar || '👤'}</span>`;
            }

            return `
                <div class="npc-item">
                    <div class="npc-avatar">${avatarContent}</div>
                    <div class="npc-info">
                        <div class="npc-name">${npc.name}</div>
                        <div class="npc-desc">${npc.setting || ''}</div>
                    </div>
                    <div class="npc-actions">
                        <button class="edit-npc-btn" onclick="chatManager.editNPC(${index})">✏️</button>
                        <button class="delete-npc-btn" onclick="chatManager.deleteNPC(${index})">🗑️</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    toggleNPCList() {
        const container = document.getElementById('npc-list-container');
        if (!container) return;
        const isVisible = container.style.display !== 'none';
        container.style.display = isVisible ? 'none' : 'block';
        // 切换按钮文本
        const button = document.querySelector('.toggle-npc-btn');
        if (button) {
            button.textContent = isVisible ? '▼' : '▲';
        }
    }

    /**
     * 绑定选项卡事件
     */
    bindTabEvents() {
        const container = document.getElementById('mammy-center-panel');
        if (!container) return;
        container.querySelectorAll('.tab-btn').forEach(btn => {
            btn.removeEventListener('click', this._boundTabHandler); // 避免重复绑定
            const handler = () => {
                const tabName = btn.getAttribute('data-tab');
                this.switchTab(tabName);
            };
            btn.addEventListener('click', handler);
            btn._boundTabHandler = handler;
        });
    }

    /**
     * 添加NPC
     */
    addNPC() {
        const name = prompt('请输入NPC名称：');
        if (name) {
            const world = this.worldBooks.find(w => w.id === this.currentWorldId);
            if (world) {
                world.npcs.push({
                    id: `npc_${Date.now()}`,
                    name: name,
                    avatar: '👤',
                    setting: '',
                    relationToOC: ''
                });
                localStorage.setItem('worldBooks', JSON.stringify(this.worldBooks));
                this.renderNPCList(world.npcs);
            }
        }
    }

    /**
     * 编辑NPC
     */
    editNPC(index) {
        const world = this.worldBooks.find(w => w.id === this.currentWorldId);
        if (!world || !world.npcs[index]) return;

        const npc = world.npcs[index];

        // 填充表单进行编辑
        document.getElementById('world-npc-name').value = npc.name;
        document.getElementById('world-npc-avatar').value = npc.avatar || '👤';
        document.getElementById('world-npc-setting').value = npc.setting || '';
        document.getElementById('world-npc-relation').value = npc.relationToOC || '';

        // 设置编辑索引标记
        npc._editing = true;

        // 展开NPC列表
        const npcContainer = document.getElementById('npc-list-container');
        if (npcContainer) {
            npcContainer.style.display = 'block';
        }

        // 滚动到表单
        document.getElementById('world-npc-name').focus();
    }

    /**
     * 删除NPC
     */
    deleteNPC(index) {
        const world = this.worldBooks.find(w => w.id === this.currentWorldId);
        if (world && world.npcs[index]) {
            if (confirm('确定要删除这个NPC吗？')) {
                world.npcs.splice(index, 1);
                localStorage.setItem('worldBooks', JSON.stringify(this.worldBooks));
                this.renderNPCList(world.npcs);
            }
        }
    }

    /**
     * 导出所有数据
     */
    exportData() {
        const data = {
            chatData: JSON.parse(localStorage.getItem('chatData') || '[]'),
            forumData: JSON.parse(localStorage.getItem('forumData') || '[]'),
            mammySettings: this.mammySettings,
            worldBooks: this.worldBooks || []
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'oc-metaverse-data.json';
        a.click();
        URL.revokeObjectURL(url);
    }

    /**
     * 导入数据
     */
    importData(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (data.chatData) localStorage.setItem('chatData', JSON.stringify(data.chatData));
                if (data.forumData) localStorage.setItem('forumData', JSON.stringify(data.forumData));
                if (data.mammySettings) {
                    this.mammySettings = data.mammySettings;
                    localStorage.setItem('mammySettings', JSON.stringify(this.mammySettings));
                }
                if (data.worldBooks) {
                    this.worldBooks = data.worldBooks;
                    localStorage.setItem('worldBooks', JSON.stringify(this.worldBooks));
                }
                location.reload();
            } catch (err) {
                this.showNotification('导入失败：文件格式错误');
            }
        };
        reader.readAsText(file);
    }

    /**
     * 删除表情分组
     */
    deleteEmotionGroup(group) {
        if (confirm(`确定要删除分组 "${group}" 吗？`)) {
            delete this.mammySettings.emotions[group];
            this.saveMammySettings();
            this.renderEmotionsManager();
        }
    }

    populatePartnerOptions(selectElement) {
        const options = selectElement.querySelectorAll('option:not([value=""])');
        options.forEach(option => option.remove());
        const singleChats = this.chats.filter(chat => !chat.isGroup);
        singleChats.forEach(chat => {
            const option = document.createElement('option');
            option.value = chat.id;
            const displayName = chat.remarkName || chat.nickname || chat.name;
            option.textContent = displayName;
            selectElement.appendChild(option);
        });
    }

    closeSettings() {
        const settings = document.getElementById('profile-settings');
        const overlay = document.getElementById('overlay');
        settings.classList.remove('active');
        overlay.classList.remove('active');
    }

    /**
     * 关闭群聊设置页面
     */
    closeGroupSettings() {
        const panel = document.getElementById('group-settings-panel');
        if (panel) panel.classList.remove('active');
    }

    deleteCurrentCharacter() {
        if (!this.currentChat || this.currentChat.isGroup) return;

        const chatName = this.currentChat.name;

        const modal = document.getElementById('confirm-modal');
        const title = document.getElementById('confirm-modal-title');
        const message = document.getElementById('confirm-modal-message');
        const confirmBtn = document.getElementById('confirm-confirm-btn');
        const cancelBtn = document.getElementById('confirm-cancel-btn');

        if (!modal || !title || !message) return;

        title.textContent = '删除角色';
        message.textContent = `确定要删除角色"${chatName}"吗？此操作不可恢复。`;
        modal.classList.add('active');

        const onConfirm = () => {
            // 执行删除
            this.chats = this.chats.filter(c => c.id !== this.currentChat.id);
            this.syncContactsFromChats();
            this.saveChats();
            this.closeSettings();
            this.closeChat();
            this.renderContacts();
            this.renderChatList();
            this.showNotification(`角色"${chatName}"已删除`);

            modal.classList.remove('active');
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
        };

        const onCancel = () => {
            modal.classList.remove('active');
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
        };

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
    }

    /**
     * 删除当前群聊
     */
    deleteCurrentGroup() {
        if (!this.currentChat || !this.currentChat.isGroup) return;

        const groupName = this.currentChat.name;
        const groupId = this.currentChat.id;

        const modal = document.getElementById('confirm-modal');
        const title = document.getElementById('confirm-modal-title');
        const message = document.getElementById('confirm-modal-message');
        const confirmBtn = document.getElementById('confirm-confirm-btn');
        const cancelBtn = document.getElementById('confirm-cancel-btn');

        if (!modal || !title || !message) return;

        title.textContent = '删除群聊';
        message.textContent = `确定要删除群聊“${groupName}”吗？此操作不可恢复。`;
        modal.classList.add('active');

        const onConfirm = () => {
            // 执行删除
            this.chats = this.chats.filter(c => c.id !== groupId);
            this.syncContactsFromChats();
            this.saveChats();
            this.closeGroupSettings();
            this.closeChat(); // 如果正在查看该群聊，关闭聊天窗口
            this.renderContacts();
            this.renderChatList();
            this.showNotification(`群聊“${groupName}”已删除`);

            modal.classList.remove('active');
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
        };

        const onCancel = () => {
            modal.classList.remove('active');
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
        };

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
    }


    // 秘密日记相关方法
    async checkAndGenerateSecretDiary() {
        if (!this.currentChat) return;

        const today = new Date().toDateString();
        if (!this.currentChat.secretDiaries) this.currentChat.secretDiaries = [];

        const todayDiary = this.currentChat.secretDiaries.find(
            d => new Date(d.date).toDateString() === today
        );

        if (!todayDiary) {
            await this.generateSecretDiary();
        } else {
            this.renderSecretDiaryPanel();
        }
    }

    async generateSecretDiary(targetChatId) {
        const targetChat = this.getChat(targetChatId);
        if (!targetChat) {
            throw new Error('目标角色不存在');
        }

        try {
            const chatHistory = targetChat.messages?.slice(-10) || [];
            const personality = targetChat.personalityPrompt || '';
            const worldId = targetChat.worldId;
            let worldDesc = '';
            if (worldId) {
                const world = this.worldBooks.find(w => w.id === worldId);
                if (world && world.description) worldDesc = world.description;
            }

            const today = new Date();
            const year = today.getFullYear();
            const month = String(today.getMonth() + 1).padStart(2, '0');
            const day = String(today.getDate()).padStart(2, '0');
            const todayStr = `${year}-${month}-${day}`;

            const prompt = `根据以下角色设定和最近的对话，生成角色今天的秘密日记（字数在1000字左右）：

角色设定：${personality}
${worldDesc ? `世界观：${worldDesc}` : ''}
最近对话：${chatHistory.map(m => `${m.isMe ? '我' : targetChat.name}：${m.text}`).join('\n')}

日记要求：
1. 使用第一人称，手写风格，带情绪化表达
2. 内容要结合角色的性格、人际关系、世界观，避免同质化
3. 包含天气（☀️/🌧️/☁️/⛅）、心情（😊/😢/😠/😌/🥰/😤等）、地点
4. 字数控制在1000字左右，内容充实
5. 【重要】不要在正文中重复写日期、天气、心情、地点，这些字段已在JSON中单独给出。

输出格式（纯JSON，不要有其他文字）：
{
    "weather": "天气emoji",
    "mood": "心情emoji",
    "location": "地点",
    "content": "日记正文"
}`;

            const response = await fetch(this.mammySettings.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.mammySettings.apiKey}`
                },
                body: JSON.stringify({
                    model: this.mammySettings.modelName,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.8,
                                    })
            });

            const data = await response.json();
            let content = data.choices[0].message.content;
            console.log('AI原始回复:', content);

            let jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                let jsonStr = jsonMatch[0];
                if (!jsonStr.endsWith('}')) jsonStr += '}';
                const diaryData = JSON.parse(jsonStr);

                if (!targetChat.secretDiaries) targetChat.secretDiaries = [];

                // 移除今天已有的日记
                targetChat.secretDiaries = targetChat.secretDiaries.filter(
                    d => d.date !== todayStr
                );

                targetChat.secretDiaries.push({
                    date: todayStr,
                    weather: diaryData.weather,
                    mood: diaryData.mood,
                    location: diaryData.location,
                    content: diaryData.content,
                    id: Date.now()
                });

                this.saveChats();
            } else {
                throw new Error('未找到JSON格式');
            }
        } catch (error) {
            console.error('生成秘密日记失败:', error);
            throw error;
        }
    }

    renderSecretDiaryPanel() {
        if (!this.currentChat || !this.currentChat.secretDiaries) return;

        const container = document.getElementById('secret-diary-entries');
        if (!container) return;

        // 显示最新日记，如果没有特定日期的日记则显示今天的
        const today = new Date().toISOString().slice(0,10);
        const todayDiary = this.currentChat.secretDiaries.find(d => d.date === today);

        if (todayDiary) {
            this.showSecretDiaryForDate(new Date());
        } else {
            // 显示最新的一篇日记
            const latestDiary = [...this.currentChat.secretDiaries].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
            if (latestDiary) {
                this.showSecretDiaryForDate(new Date(latestDiary.date));
            } else {
                // 没有日记时显示空状态
                container.innerHTML = `
                    <div class="diary-entry empty-diary">
                        <div style="text-align: center; color: #999; padding: 40px;">
                            <div style="font-size: 48px;">📭</div>
                            <p>还没有秘密日记</p>
                            <button class="submit-btn" onclick="chatManager.refreshSecretDiary()" style="margin-top: 12px;">✨ 生成今日日记</button>
                        </div>
                    </div>
                `;
            }
        }
    }

    normalizeSecretDiaryDates() {
        if (!this.currentChat || !this.currentChat.secretDiaries) return;
        let changed = false;
        this.currentChat.secretDiaries.forEach(diary => {
            if (diary.date && diary.date.includes('年')) {
                // 将 "2025年7月16日" 转换为 "2025-07-16"
                const match = diary.date.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
                if (match) {
                    const year = match[1];
                    const month = match[2].padStart(2,'0');
                    const day = match[3].padStart(2,'0');
                    diary.date = `${year}-${month}-${day}`;
                    changed = true;
                }
            }
        });
        if (changed) this.saveChats();
    }

    // 编辑功能已移除，保留方法为空实现
    editSecretDiaryEntry(id) {
        // 编辑功能已禁用
        this.showNotification('编辑功能已禁用');
    }

    deleteSecretDiaryEntry(id) {
        if (!this.currentChat || !this.currentChat.secretDiaries) return;

        if (confirm('确定要删除这篇日记吗？')) {
            this.currentChat.secretDiaries = this.currentChat.secretDiaries.filter(e => e.id !== id);
            this.saveChats();
            this.renderSecretDiaryPanel();
            this.renderSecretDiaryCalendar();
        }
    }

    // 心情日记
    renderMoodDiary() {
        if (!this.currentChat || !this.currentChat.secretDiaries) return;

        const container = document.getElementById('mood-diary-entries');
        if (!container) return;

        // 从秘密日记中提取心情记录
        const moodEntries = this.currentChat.secretDiaries
            .filter(entry => entry.mood) // 只显示有心情表情的日记
            .reverse(); // 倒序显示

        container.innerHTML = moodEntries.map(entry => `
            <div class="mood-entry">
                <span class="mood-icon">${entry.mood}</span>
                <div class="mood-content">
                    <div class="mood-text">${(entry.content || '').substring(0, 50)}${(entry.content || '').length > 50 ? '...' : ''}</div>
                    <div class="mood-date">${new Date(entry.date).toLocaleDateString()}</div>
                </div>
            </div>
        `).join('');
    }

    renderSecretDiaryCalendar() {
    const year = this.secretDiaryYear;
    const month = this.secretDiaryMonth;
    const firstDayDate = new Date(year, month, 1);
    const firstDay = firstDayDate.getDay(); // 本地星期几
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

    // 更新标题
    const titleEl = document.getElementById('diary-calendar-month-year');
    if (titleEl) titleEl.textContent = `${year}年 ${monthNames[month]}`;

    const calendarDiv = document.getElementById('diary-calendar');
    if (!calendarDiv) return;
    calendarDiv.innerHTML = '';

    // 月初空白
    for (let i = 0; i < firstDay; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'calendar-day empty';
        calendarDiv.appendChild(emptyCell);
    }

    // 当月日期
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const hasDiary = this.currentChat.secretDiaries?.some(diary => diary.date === dateStr);
        const dayDiv = document.createElement('div');
        dayDiv.className = 'calendar-day';
        if (hasDiary) dayDiv.classList.add('has-diary');
        dayDiv.innerHTML = `<div class="day-number">${d}</div>`;

        // 使用立即执行函数捕获当前的 year, month, d
        (function(y, m, dNum) {
            dayDiv.addEventListener('click', () => {
                const selectedDate = new Date(y, m, dNum);
                chatManager.showSecretDiaryForDate(selectedDate);
                // 同步日期选择器
                const datePicker = document.getElementById('secret-diary-date-picker');
                if (datePicker) {
                    const yy = selectedDate.getFullYear();
                    const mm = String(selectedDate.getMonth() + 1).padStart(2, '0');
                    const dd = String(selectedDate.getDate()).padStart(2, '0');
                    datePicker.value = `${yy}-${mm}-${dd}`;
                }
                // 如果选中日期的月份与当前日历月份不同，切换日历显示
                if (y !== chatManager.secretDiaryYear || m !== chatManager.secretDiaryMonth) {
                    chatManager.secretDiaryYear = y;
                    chatManager.secretDiaryMonth = m;
                    chatManager.renderSecretDiaryCalendar();
                }
            });
        })(year, month, d);

        calendarDiv.appendChild(dayDiv);
    }

    // 月末空白
    const totalCells = firstDay + daysInMonth;
    const remaining = (7 - (totalCells % 7)) % 7;
    for (let i = 0; i < remaining; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'calendar-day empty';
        calendarDiv.appendChild(emptyCell);
    }
}

    changeSecretDiaryMonth(delta) {
    let newMonth = this.secretDiaryMonth + delta;
    let newYear = this.secretDiaryYear;
    if (newMonth < 0) {
        newMonth = 11;
        newYear--;
    } else if (newMonth > 11) {
        newMonth = 0;
        newYear++;
    }
    this.secretDiaryYear = newYear;
    this.secretDiaryMonth = newMonth;
    this.renderSecretDiaryCalendar();

    // 重新显示当前选中日期（保持之前选中的日期，如果没有则显示当月第一天）
    if (this.selectedDiaryDate) {
        this.showSecretDiaryForDate(this.selectedDiaryDate);
    } else {
        this.showSecretDiaryForDate(new Date(newYear, newMonth, 1));
    }
}

    showSecretDiaryForDate(date) {
    // 确保 date 是有效的 Date 对象
    let validDate = date;
    if (!(date instanceof Date) || isNaN(date.getTime())) {
        if (typeof date === 'string') {
            validDate = new Date(date);
            if (isNaN(validDate.getTime())) {
                console.error('Invalid date string:', date);
                return;
            }
        } else {
            console.error('Invalid date object:', date);
            return;
        }
    }
    // 保存当前选中的日期
    this.selectedDiaryDate = validDate;

    const year = validDate.getFullYear();
    const month = validDate.getMonth();
    const day = validDate.getDate();
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;

    const diary = this.currentChat.secretDiaries?.find(d => d.date === dateStr);
    const container = document.getElementById('secret-diary-entries');
    if (!container) return;

    // 清除所有日历格子的选中状态
    document.querySelectorAll('#diary-calendar .calendar-day').forEach(day => {
        day.classList.remove('selected');
    });
    // 高亮当前选中的日期格子
    const allDays = document.querySelectorAll('#diary-calendar .calendar-day');
    for (let cell of allDays) {
        const dayNumber = cell.querySelector('.day-number')?.textContent;
        if (dayNumber && !cell.classList.contains('empty') && parseInt(dayNumber) === day) {
            cell.classList.add('selected');
            break;
        }
    }

    if (diary) {
        container.innerHTML = `
            <div class="diary-entry">
                <div class="diary-header">
                    <span class="diary-date">${diary.date}</span>
                    ${diary.weather ? `<span class="diary-weather">${diary.weather}</span>` : ''}
                    ${diary.mood ? `<span class="diary-mood">${diary.mood}</span>` : ''}
                    ${diary.location ? `<span class="diary-location">📍${diary.location}</span>` : ''}
                </div>
                <div class="diary-content" style="white-space: pre-wrap;">${diary.content || ''}</div>
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="diary-entry empty-diary">
                <div style="text-align: center; color: #999; padding: 40px;">
                    <div style="font-size: 48px;">📭</div>
                    <p>这一天没有秘密日记</p>
                </div>
            </div>
        `;
    }
}

    updateSecretDiaryButtonState() {
        if (!this.currentChat) return;
        const isGenerating = this.generatingDiaryForChat && this.generatingDiaryForChat.has(this.currentChat.id);
        const refreshBtn = document.getElementById('refresh-secret-diary-btn');
        if (!refreshBtn) return;
        if (isGenerating) {
            refreshBtn.disabled = true;
            refreshBtn.textContent = '✨ 生成中...';
        } else {
            refreshBtn.disabled = false;
            refreshBtn.textContent = '✨ 刷新今日日记';
        }
    }

    updateMusicButtonState() {
        if (!this.currentChat) return;
        const isGenerating = this.generatingMusicForChat.has(this.currentChat.id);
        const refreshBtn = document.getElementById('refresh-music-btn');
        if (refreshBtn) {
            refreshBtn.disabled = isGenerating;
            refreshBtn.textContent = isGenerating ? '✨ 生成中...' : '✨ 刷新今日歌单';
        }
    }

    updateMoodButtonState() {
        if (!this.currentChat) return;
        const isGenerating = this.generatingMoodForChat.has(this.currentChat.id);
        const refreshBtn = document.getElementById('refresh-mood-diary-btn');
        if (refreshBtn) {
            refreshBtn.disabled = isGenerating;
            refreshBtn.textContent = isGenerating ? '✨ 生成中...' : '✨ 刷新今日心情';
        }
    }

    updateTaskButtonState() {
        if (!this.currentChat) return;
        const isGenerating = this.generatingTaskForChat.has(this.currentChat.id);
        const refreshBtn = document.getElementById('refresh-tasks-btn');
        if (refreshBtn) {
            refreshBtn.disabled = isGenerating;
            refreshBtn.textContent = isGenerating ? '🔄 生成中...' : '🔄 刷新进度';
        }
    }

    async refreshSecretDiary() {
        if (!this.currentChat) return;
        const chatId = this.currentChat.id;
        if (this.generatingDiaryForChat && this.generatingDiaryForChat.has(chatId)) {
            this.showNotification('该角色正在生成日记，请稍后再试');
            return;
        }
        const todayStr = new Date().toISOString().slice(0,10);
        const existing = this.currentChat.secretDiaries?.find(d => d.date === todayStr);
        if (existing) {
            this.showNotification('今天已经写过秘密日记了，明天再来吧');
            return;
        }

        // 标记生成中
        if (!this.generatingDiaryForChat) this.generatingDiaryForChat = new Set();
        this.generatingDiaryForChat.add(chatId);
        this.updateSecretDiaryButtonState();

        try {
            await this.generateSecretDiary(chatId);
            // 生成成功后，如果当前角色仍然是发起生成的角色，则刷新界面
            if (this.currentChat && this.currentChat.id === chatId) {
                this.renderSecretDiaryCalendar();
                this.showSecretDiaryForDate(new Date());
            } else {
                const targetChat = this.getChat(chatId);
                if (targetChat) {
                    this.showNotification(`日记已生成到 ${targetChat.name} 的日记中`);
                }
            }
        } catch (error) {
            console.error('生成日记失败', error);
            this.showNotification('生成日记失败，请重试');
        } finally {
            this.generatingDiaryForChat.delete(chatId);
            // 如果当前角色没有变化，恢复按钮状态；否则会由下次 open 或 update 重置
            if (this.currentChat && this.currentChat.id === chatId) {
                this.updateSecretDiaryButtonState();
            }
        }
    }

    // 音乐相关
    
    // 秘密日记面板
    openSecretDiary() {
    if (!this.currentChat) return;
    this.closeAllPanels();
    // 修复旧数据中的日期格式
    this.normalizeSecretDiaryDates();

    const panel = document.getElementById('secret-diary-panel');
    const overlay = document.getElementById('overlay');
    panel.classList.add('active');
    overlay.classList.add('active');

    this.secretDiaryYear = new Date().getFullYear();
    this.secretDiaryMonth = new Date().getMonth();
    this.renderSecretDiaryCalendar();

    // 绑定事件
    document.getElementById('close-secret-diary').onclick = () => this.closeSecretDiary();

    // 设置刷新按钮状态（根据当前角色是否正在生成）
    this.updateSecretDiaryButtonState();

    const refreshBtn = document.getElementById('refresh-secret-diary-btn');
    // 移除原有监听器，避免重复绑定
    const newRefreshBtn = refreshBtn.cloneNode(true);
    refreshBtn.parentNode.replaceChild(newRefreshBtn, refreshBtn);
    newRefreshBtn.onclick = () => this.refreshSecretDiary();

    const datePicker = document.getElementById('secret-diary-date-picker');
    if (datePicker) {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        datePicker.value = `${yyyy}-${mm}-${dd}`;
        datePicker.onchange = (e) => {
            const selectedDate = new Date(e.target.value);
            if (!isNaN(selectedDate.getTime())) {
                this.showSecretDiaryForDate(selectedDate);
                if (selectedDate.getFullYear() !== this.secretDiaryYear || selectedDate.getMonth() !== this.secretDiaryMonth) {
                    this.secretDiaryYear = selectedDate.getFullYear();
                    this.secretDiaryMonth = selectedDate.getMonth();
                    this.renderSecretDiaryCalendar();
                }
            }
        };
    }

    document.getElementById('diary-prev-month-btn').onclick = () => this.changeSecretDiaryMonth(-1);
    document.getElementById('diary-next-month-btn').onclick = () => this.changeSecretDiaryMonth(1);

    this.showSecretDiaryForDate(new Date());
}

    closeSecretDiary() {
        const panel = document.getElementById('secret-diary-panel');
        const overlay = document.getElementById('overlay');
        panel.classList.remove('active');
        overlay.classList.remove('active');
    }

    // 心情日记面板
    openMoodDiary() {
        if (!this.currentChat) return;
        this.closeAllPanels();

        const panel = document.getElementById('mood-diary-panel');
        const overlay = document.getElementById('overlay');
        panel.classList.add('active');
        overlay.classList.add('active');

        // 渲染日历
        this.renderMoodCalendar();

        // 初始化统计图表
        this.initMoodStats();

        // ===== 新增：重置总结区域，避免显示上一个角色的总结 =====
        const summaryContent = document.getElementById('mood-summary-content');
        if (summaryContent) {
            summaryContent.innerHTML = '<p style="color: var(--text-secondary); text-align: center;">点击生成总结，AI将分析角色的情绪变化</p>';
        }
        // ===== 重置结束 =====

        // 绑定刷新按钮事件
        const refreshBtn = document.getElementById('refresh-mood-diary-btn');
        if (refreshBtn) {
            refreshBtn.onclick = () => this.refreshMoodDiary();
        }

        // 绑定月份切换按钮
        document.getElementById('prev-month-btn').onclick = () => this.changeMoodMonth(-1);
        document.getElementById('next-month-btn').onclick = () => this.changeMoodMonth(1);

        document.getElementById('close-mood-diary').onclick = () => this.closeMoodDiary();

        // 绑定生成总结按钮（确保只绑定一次，避免重复）
        const summaryBtn = document.getElementById('generate-summary-btn');
        if (summaryBtn) {
            // 先移除旧的监听器，再添加新的（避免重复绑定导致多次调用）
            summaryBtn.removeEventListener('click', this._boundSummaryHandler);
            const handler = () => this.generateMoodSummary();
            summaryBtn.addEventListener('click', handler);
            this._boundSummaryHandler = handler;
        }
    }

    closeMoodDiary() {
        const panel = document.getElementById('mood-diary-panel');
        const overlay = document.getElementById('overlay');
        panel.classList.remove('active');
        overlay.classList.remove('active');
    }

    renderMoodCalendar() {
        if (!this.currentChat) return;
        const year = this.currentMoodYear;
        const month = this.currentMoodMonth;
        const firstDay = new Date(year, month, 1).getDay(); // 周日为0
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        // 更新标题
        const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
        document.getElementById('calendar-month-year').textContent = `${year}年 ${monthNames[month]}`;

        const calendarDiv = document.getElementById('mood-calendar');
        calendarDiv.innerHTML = '';

        // 填充空白格子（月初偏移）
        for (let i = 0; i < firstDay; i++) {
            const emptyCell = document.createElement('div');
            emptyCell.className = 'calendar-day empty';
            calendarDiv.appendChild(emptyCell);
        }

        // 填充日期格子
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const entry = this.currentChat.moodDiaries?.find(e => e.date === dateStr);

            const dayDiv = document.createElement('div');
            dayDiv.className = 'calendar-day';
            if (entry) dayDiv.classList.add('has-mood');

            // 显示日期数字和心情emoji
            const dayNumberSpan = document.createElement('div');
            dayNumberSpan.className = 'day-number';
            dayNumberSpan.textContent = d;
            dayDiv.appendChild(dayNumberSpan);

            if (entry && entry.emoji) {
                const emojiSpan = document.createElement('div');
                emojiSpan.className = 'day-emoji';
                emojiSpan.textContent = entry.emoji;
                dayDiv.appendChild(emojiSpan);
            }

            dayDiv.addEventListener('click', () => {
                if (entry) {
                    this.openMoodSticky(entry);
                } else {
                    this.openMoodSticky(null, dateStr);
                }
            });

            calendarDiv.appendChild(dayDiv);
        }
    }

    changeMoodMonth(delta) {
        let newMonth = this.currentMoodMonth + delta;
        let newYear = this.currentMoodYear;
        if (newMonth < 0) {
            newMonth = 11;
            newYear--;
        } else if (newMonth > 11) {
            newMonth = 0;
            newYear++;
        }
        this.currentMoodYear = newYear;
        this.currentMoodMonth = newMonth;
        this.renderMoodCalendar();
        // 切换月份后更新统计为月视图
        this.updateMoodStats('month');
    }

    openMoodSticky(entry, dateStr = null) {
        const modal = document.getElementById('mood-sticky-modal');
        const body = document.getElementById('sticky-body');

        if (entry) {
            body.innerHTML = `
                <div class="sticky-emoji">${entry.emoji}</div>
                <div class="sticky-mood">${entry.mood}</div>
                <div class="sticky-note-text">${entry.note}</div>
            `;
        } else {
            body.innerHTML = `
                <div style="text-align: center; color: #999;">
                    <div style="font-size: 48px;">📭</div>
                    <p>${dateStr ? this.formatDate(dateStr) : '这一天'} 没有心情记录</p>
                </div>
            `;
        }
        modal.classList.add('active');
    }

    closeMoodSticky() {
        const modal = document.getElementById('mood-sticky-modal');
        if (modal) modal.classList.remove('active');
    }

    initMoodStats() {
        // 绑定视图切换按钮事件
        const btns = document.querySelectorAll('.stats-view-btn');
        btns.forEach(btn => {
            btn.removeEventListener('click', this._boundStatHandler);
            const handler = (e) => {
                const period = btn.getAttribute('data-period');
                this.currentStatPeriod = period;
                btns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.updateMoodStats(period);
            };
            btn.addEventListener('click', handler);
            btn._boundStatHandler = handler;
        });
        // 默认加载当前周期统计
        this.updateMoodStats(this.currentStatPeriod);
    }

    updateMoodStats(period) {
        if (!this.currentChat) return;
        const diaries = this.currentChat.moodDiaries || [];
        if (diaries.length === 0) {
            this.clearCharts();
            return;
        }

        // 根据 period 过滤数据
        const now = new Date();
        let filtered = [];
        const todayStr = now.toISOString().slice(0,10);

        switch(period) {
            case 'day':
                filtered = diaries.filter(d => d.date === todayStr);
                break;
            case 'week':
                // 计算本周一的日期（周一为一周开始）
                const currentDay = now.getDay();
                const diffToMonday = currentDay === 0 ? 6 : currentDay - 1;
                const monday = new Date(now);
                monday.setDate(now.getDate() - diffToMonday);
                const mondayStr = monday.toISOString().slice(0,10);
                const sunday = new Date(monday);
                sunday.setDate(monday.getDate() + 6);
                const sundayStr = sunday.toISOString().slice(0,10);
                filtered = diaries.filter(d => d.date >= mondayStr && d.date <= sundayStr);
                break;
            case 'month':
                const yearMonth = now.toISOString().slice(0,7); // "2025-04"
                filtered = diaries.filter(d => d.date.startsWith(yearMonth));
                break;
            case 'year':
                const year = now.getFullYear().toString();
                filtered = diaries.filter(d => d.date.startsWith(year));
                break;
            default: filtered = diaries;
        }

        if (filtered.length === 0) {
            this.clearCharts();
            return;
        }

        // 统计情绪频率
        const moodCount = {};
        filtered.forEach(d => {
            const mood = d.mood || '其他';
            moodCount[mood] = (moodCount[mood] || 0) + 1;
        });

        const labels = Object.keys(moodCount);
        const data = Object.values(moodCount);
        const colors = this.generateChartColors(labels.length);

        // 更新饼图
        const pieCtx = document.getElementById('mood-pie-chart')?.getContext('2d');
        if (pieCtx) {
            if (this.moodChartPie) this.moodChartPie.destroy();
            this.moodChartPie = new Chart(pieCtx, {
                type: 'pie',
                data: {
                    labels: labels,
                    datasets: [{
                        data: data,
                        backgroundColor: colors,
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: { position: 'bottom' },
                        tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${ctx.raw} 次` } }
                    }
                }
            });
        }

        // 更新条形图
        const barCtx = document.getElementById('mood-bar-chart')?.getContext('2d');
        if (barCtx) {
            if (this.moodChartBar) this.moodChartBar.destroy();
            this.moodChartBar = new Chart(barCtx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '情绪次数',
                        data: data,
                        backgroundColor: colors,
                        borderRadius: 8
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: { display: false },
                        tooltip: { callbacks: { label: (ctx) => `${ctx.raw} 次` } }
                    },
                    scales: {
                        y: { beginAtZero: true, ticks: { stepSize: 1 } }
                    }
                }
            });
        }
    }

    clearCharts() {
        if (this.moodChartPie) {
            this.moodChartPie.destroy();
            this.moodChartPie = null;
        }
        if (this.moodChartBar) {
            this.moodChartBar.destroy();
            this.moodChartBar = null;
        }
        const pieCtx = document.getElementById('mood-pie-chart')?.getContext('2d');
        const barCtx = document.getElementById('mood-bar-chart')?.getContext('2d');
        if (pieCtx) pieCtx.clearRect(0, 0, 200, 200);
        if (barCtx) barCtx.clearRect(0, 0, 400, 200);
    }

    generateChartColors(count) {
        const baseColors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40', '#8A2BE2', '#00CED1', '#FF4500', '#2E8B57'];
        const colors = [];
        for (let i = 0; i < count; i++) {
            colors.push(baseColors[i % baseColors.length]);
        }
        return colors;
    }

    async refreshMoodDiary() {
        if (!this.currentChat) return;
        const chatId = this.currentChat.id;
        if (this.generatingMoodForChat.has(chatId)) {
            this.showNotification('该角色正在生成心情日记，请稍后再试');
            return;
        }
        const todayStr = new Date().toISOString().slice(0,10);
        const existing = this.currentChat.moodDiaries?.find(e => e.date === todayStr);
        if (existing) {
            this.openMoodSticky(existing);
            this.showNotification('今天的心情日记已经写过了');
            return;
        }

        // 概率控制
        const freq = this.currentChat.moodDiaryFrequency ?? 0.7;
        if (Math.random() > freq) {
            this.showNotification('今天似乎没有写心情日记的心情呢...');
            return;
        }

        this.generatingMoodForChat.add(chatId);
        this.updateMoodButtonState();
        const refreshBtn = document.getElementById('refresh-mood-diary-btn');
        if (refreshBtn) refreshBtn.disabled = true;

        try {
            const result = await this.generateMoodDiaryForToday(chatId);
            if (result && !result.skipped) {
                const targetChat = this.getChat(chatId);
                if (!targetChat) throw new Error('角色不存在');
                if (!targetChat.moodDiaries) targetChat.moodDiaries = [];
                targetChat.moodDiaries.push({
                    date: todayStr,
                    emoji: result.emoji,
                    mood: result.mood,
                    note: result.note
                });
                this.saveChats();
                if (this.currentChat && this.currentChat.id === chatId) {
                    this.renderMoodCalendar();
                    this.updateMoodStats(this.currentStatPeriod);
                    this.openMoodSticky(result, todayStr);
                } else {
                    const targetChatName = targetChat.name;
                    this.showNotification(`心情日记已生成到 ${targetChatName} 的日记中`);
                }
            } else {
                this.showNotification('今天似乎没有写心情日记的心情呢...');
            }
        } catch (error) {
            console.error('生成心情日记失败', error);
            this.showNotification('生成失败，请稍后重试');
        } finally {
            this.generatingMoodForChat.delete(chatId);
            // 强制恢复按钮文本，避免状态残留
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.textContent = '✨ 生成今日心情';
            }
            // 如果当前角色是发起生成的角色，额外更新状态
            if (this.currentChat && this.currentChat.id === chatId) {
                this.updateMoodButtonState();
            }
        }
    }

    async generateMoodDiaryForToday(chatId) {
        const chat = this.getChat(chatId);
        if (!chat) return null;

        // 获取最近对话上下文
        const recentMessages = chat.messages.slice(-10).map(msg => ({
            role: msg.isMe ? 'user' : 'assistant',
            content: msg.text || msg.content || ''
        }));

        const roleSetting = `你是${chat.name}。${chat.personalityPrompt ? '性格：'+chat.personalityPrompt : ''}`;
        const recentContext = `最近对话：\n${recentMessages.map(m => `${m.role === 'user' ? '妈咪' : chat.name}：${m.content}`).join('\n')}`;

        const systemPrompt = `你是一个生活在独立世界中的虚拟角色，拥有自己的日常生活、人际关系和情绪变化。
请根据以下设定，**推测你今天（${new Date().toLocaleDateString()}）在自己的世界中可能经历了什么事件、被谁影响**，从而产生了某种心情。
你的心情主要来源于你世界中的经历，而不是因为和妈咪的对话。
${roleSetting}
${recentContext}

【重要】为了避免日记内容重复单调，请你每次生成不同的事件和情绪。可以随机选择以下情绪方向：开心、难过、平静、兴奋、感动、孤独、愤怒、期待、焦虑、幸福、疲惫、害羞、自豪、嫉妒、后悔等。事件也尽量多样化，比如：
- 与配对角色或NPC的互动（聊天、一起做事、争吵、和解等）
- 独自思考、回忆、反思
- 遇到小确幸或小挫折
- 天气、环境带来的心情变化
- 完成某件事的成就感
- 对未来的期待或担忧

请输出JSON格式的心情日记：
- "emoji": 一个代表心情的emoji
- "mood": 情绪词（如开心、难过、平静、愤怒、兴奋、感动、孤独、期待等）
- "note": 一句话描述今天的心情及原因（描述你在你的世界里发生了什么）

如果今天你没有什么特别的心情变化，或者你不想写日记，请输出：{"skip": true}
只输出JSON，不要有其他文字。`;

        const userPrompt = `今天日期：${new Date().toLocaleDateString()}。最近对话：\n${recentMessages.map(m => `${m.role === 'user' ? '妈咪' : chat.name}：${m.content}`).join('\n')}\n请决定是否写心情日记。`;

        // 如果未配置API，使用模拟数据（随机决定）
        if (!this.mammySettings.apiUrl || !this.mammySettings.apiKey) {
            const rand = Math.random();
            if (rand < 0.7) { // 70%概率写日记
                const moods = [
                    { emoji: '😊', mood: '开心', note: '今天和妈咪聊天很开心呢~' },
                    { emoji: '😢', mood: '难过', note: '有点想妈咪了...' },
                    { emoji: '😌', mood: '平静', note: '今天过得还不错。' },
                    { emoji: '🥰', mood: '幸福', note: '妈咪陪着我，好幸福。' },
                    { emoji: '😤', mood: '生气', note: '今天遇到一些烦心事。' }
                ];
                return moods[Math.floor(Math.random() * moods.length)];
            } else {
                return { skipped: true };
            }
        }

        try {
            const response = await fetch(this.mammySettings.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.mammySettings.apiKey}`
                },
                body: JSON.stringify({
                    model: this.mammySettings.modelName,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: 0.8,
                                    })
            });
            const data = await response.json();
            let content = data.choices[0].message.content;
            // 尝试解析JSON
            let jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]);
                if (result.skip === true) return { skipped: true };
                if (result.emoji && result.mood && result.note) return result;
            }
            // 降级返回默认
            return { skipped: true };
        } catch (error) {
            console.error('AI心情日记生成失败', error);
            return { skipped: true };
        }
    }

    postMoodDynamic(chatId, emoji, mood, note) {
        // 预留：动态功能暂时不实现，仅打印日志
        console.log(`[动态预留] ${chatId} 发布心情动态：${emoji} ${mood} - ${note}`);
        // 以后可以调用 this.postTextDynamic(`心情：${emoji} ${mood}\n${note}`);
    }

    /**
     * 生成心情日记的 AI 总结报告
     */
    async generateMoodSummary() {
        if (!this.currentChat) return;
        const diaries = this.currentChat.moodDiaries || [];
        if (diaries.length === 0) {
            const summaryDiv = document.getElementById('mood-summary-content');
            if (summaryDiv) summaryDiv.innerHTML = '<p style="color: var(--text-secondary); text-align: center;">暂无心情记录，无法生成总结</p>';
            return;
        }

        // 按日期排序
        const sorted = [...diaries].sort((a, b) => new Date(a.date) - new Date(b.date));

        // 统计情绪频率
        const moodCount = {};
        sorted.forEach(d => {
            const mood = d.mood || '其他';
            moodCount[mood] = (moodCount[mood] || 0) + 1;
        });

        // 找出稀有情绪（出现次数 <= 总次数 * 0.2 且次数较少）
        const total = sorted.length;
        const rareThreshold = Math.max(1, Math.floor(total * 0.2));
        const rareMoods = Object.entries(moodCount).filter(([_, count]) => count <= rareThreshold);

        // 找出未写日记的日期（从最早的日记到最近，或者最近30天）
        const today = new Date();
        const startDate = new Date(sorted[0].date);
        const missingDates = [];
        let current = new Date(startDate);
        while (current <= today) {
            const dateStr = current.toISOString().slice(0, 10);
            if (!diaries.some(d => d.date === dateStr)) {
                missingDates.push(dateStr);
            }
            current.setDate(current.getDate() + 1);
        }
        // 只显示最近30天的缺失
        const recentMissing = missingDates.filter(d => {
            const diff = (today - new Date(d)) / (1000 * 60 * 60 * 24);
            return diff <= 30 && diff >= 0;
        });

        // 构建提示词
        const chat = this.currentChat;
        const systemPrompt = `你是一个情绪分析师。根据以下角色最近的心情日记记录，生成一份简洁的情绪分析报告（100字以内）。
报告应包含：
1. 整体情绪倾向（哪种情绪最多，占比多少）
2. 稀有情绪记录（哪些情绪较少出现，出现日期）
3. 未记录心情的日子（最近有哪些日期没有写日记，如果有的话）
4. 一句总结建议（比如是否需要关注角色的情绪变化）

角色设定：${chat.name}。${chat.personalityPrompt ? '性格：' + chat.personalityPrompt : ''}`;

        const userPrompt = `心情日记记录（按日期排序）：\n${sorted.map(d => `${d.date}：${d.emoji} ${d.mood} - ${d.note}`).join('\n')}\n\n未写日记的日期（最近30天）：${recentMissing.length > 0 ? recentMissing.join('、') : '无'}\n稀有情绪：${rareMoods.map(([m, c]) => `${m}(${c}次)`).join('、') || '无'}\n总记录数：${total}条。请生成总结。`;

        // 显示加载状态
        const summaryDiv = document.getElementById('mood-summary-content');
        if (!summaryDiv) return;
        summaryDiv.innerHTML = '<div style="display: flex; align-items: center; justify-content: center;"><div class="spinner"></div> 正在分析...</div>';

        // 如果未配置 API，使用模拟总结
        if (!this.mammySettings.apiUrl || !this.mammySettings.apiKey) {
            const topMood = Object.entries(moodCount).sort((a, b) => b[1] - a[1])[0];
            const summary = `📈 ${chat.name} 总共记录了 ${total} 天心情。\n😊 最常见情绪：${topMood[0]}（${topMood[1]}次，占比 ${Math.round(topMood[1] / total * 100)}%）\n${rareMoods.length > 0 ? `🔍 稀有情绪：${rareMoods.map(([m, c]) => `${m}(${c}次)`).join('、')}` : ''}\n${recentMissing.length > 0 ? `📭 未记录日期：${recentMissing.slice(0, 5).join('、')}${recentMissing.length > 5 ? '等' : ''}` : '🎉 记录很完整！'}`;
            summaryDiv.innerHTML = `<p>${summary}</p>`;
            return;
        }

        try {
            const response = await fetch(this.mammySettings.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.mammySettings.apiKey}`
                },
                body: JSON.stringify({
                    model: this.mammySettings.modelName,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: 0.7,
                                    })
            });
            const data = await response.json();
            let summary = data.choices[0].message.content;
            summaryDiv.innerHTML = `<p>${summary.replace(/\n/g, '<br>')}</p>`;
        } catch (error) {
            console.error('生成总结失败', error);
            summaryDiv.innerHTML = '<p style="color: #f44336;">生成总结失败，请重试</p>';
        }
    }

    // 最近音乐面板
    openMusicPanel() {
        if (!this.currentChat) return;
        this.closeAllPanels();

        const panel = document.getElementById('music-panel');
        const overlay = document.getElementById('overlay');
        panel.classList.add('active');
        overlay.classList.add('active');

        this.currentMusicDate = new Date();
        this.renderMusicForDate(this.currentMusicDate);
        this.renderMusicStats();

        // 绑定事件 - 使用 addEventListener，避免克隆
        const closeBtn = document.getElementById('close-music-panel');
        const refreshBtn = document.getElementById('refresh-music-btn');

        // 移除旧的监听器（如果有）
        if (this._musicCloseHandler) closeBtn?.removeEventListener('click', this._musicCloseHandler);
        if (this._musicRefreshHandler) refreshBtn?.removeEventListener('click', this._musicRefreshHandler);

        // 绑定新监听器
        this._musicCloseHandler = () => this.closeMusicPanel();
        this._musicRefreshHandler = () => this.refreshTodayMusic();

        if (closeBtn) closeBtn.addEventListener('click', this._musicCloseHandler);
        if (refreshBtn) refreshBtn.addEventListener('click', this._musicRefreshHandler);

        // 绑定日期选择器
        const datePicker = document.getElementById('music-date-picker');
        if (datePicker) {
            const todayStr = new Date().toISOString().slice(0,10);
            datePicker.value = todayStr;
            datePicker.onchange = (e) => {
                const selectedDate = new Date(e.target.value);
                if (!isNaN(selectedDate.getTime())) {
                    this.currentMusicDate = selectedDate;
                    this.renderMusicForDate(this.currentMusicDate);
                }
            };
        }

        // 更新按钮状态
        this.updateMusicButtonState();
    }

    closeMusicPanel() {
        const panel = document.getElementById('music-panel');
        const overlay = document.getElementById('overlay');
        panel.classList.remove('active');
        overlay.classList.remove('active');
    }

    
    // 新增：渲染指定日期的音乐
    renderMusicForDate(date) {
        if (!this.currentChat) return;
        const dateStr = date.toISOString().slice(0,10);
        const history = this.currentChat.musicHistory || [];
        const record = history.find(h => h.date === dateStr);

        const container = document.getElementById('music-list');

        // 同步日期选择器的值
        const datePicker = document.getElementById('music-date-picker');
        if (datePicker) {
            datePicker.value = dateStr;
        }

        if (record) {
            // 显示已有记录
            this.displayMusicRecord(record);
        } else {
            // 没有记录，显示空状态
            const isToday = dateStr === new Date().toISOString().slice(0,10);
            container.innerHTML = `
                <div class="music-empty">
                    <div class="music-empty-icon">🎵</div>
                    <p>${isToday ? '今天还没有听歌记录' : '这一天没有听歌记录'}</p>
                    ${isToday ? '<p class="music-empty-hint">点击左上角「刷新今日歌单」按钮生成</p>' : ''}
                </div>
            `;
        }
    }

    // 新增：格式化日期显示
    formatDate(dateStr) {
        const date = new Date(dateStr);
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (date.toDateString() === today.toDateString()) {
            return '今天';
        } else if (date.toDateString() === yesterday.toDateString()) {
            return '昨天';
        } else {
            return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
        }
    }

    // 新增：显示音乐记录
    displayMusicRecord(record) {
        const container = document.getElementById('music-list');
        // 生成歌曲列表 HTML
        const songsHtml = record.songs.map((song, idx) => `
            <div class="music-song-item">
                <span class="music-song-num">${idx+1}</span>
                <span class="music-play-icon">▶</span>
                <div class="music-song-info">
                    <div class="music-song-name">${this.escapeHtml(song.name)}</div>
                    <div class="music-song-artist">${this.escapeHtml(song.artist)}</div>
                </div>
            </div>
        `).join('');

        container.innerHTML = `
            <div class="music-card">
                <div class="music-card-vinyl">
                    <div class="vinyl-record"></div>
                    <div class="vinyl-center"></div>
            </div>
            <div class="music-card-content">
                <div class="music-note">“${this.escapeHtml(record.note)}”</div>
                <div class="music-song-list">${songsHtml}</div>
            </div>
        </div>
    `;
    }

    // 新增：HTML转义方法，防止XSS
    escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>]/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        });
    }

    // 新增：刷新今日歌单
    async refreshTodayMusic() {
        if (!this.currentChat) return;
        const chatId = this.currentChat.id;
        if (this.generatingMusicForChat.has(chatId)) {
            this.showNotification('该角色正在生成歌单，请稍后再试');
            return;
        }
        const todayStr = new Date().toISOString().slice(0,10);
        const existing = this.currentChat.musicHistory?.find(h => h.date === todayStr);
        if (existing) {
            this.showNotification('今日歌单已生成过，无需重复刷新');
            this.renderMusicForDate(new Date());
            return;
        }

        this.generatingMusicForChat.add(chatId);
        this.updateMusicButtonState();
        const refreshBtn = document.getElementById('refresh-music-btn');
        if (refreshBtn) refreshBtn.disabled = true;

        try {
            const result = await this.generateMusicForToday(chatId);
            if (result && result.songs && result.songs.length > 0) {
                const targetChat = this.getChat(chatId);
                if (!targetChat) throw new Error('角色不存在');
                const record = {
                    date: todayStr,
                    timestamp: new Date().toISOString(),
                    songs: result.songs,
                    note: result.note
                };
                if (!targetChat.musicHistory) targetChat.musicHistory = [];
                targetChat.musicHistory.push(record);
                this.saveChats();
                if (this.currentChat && this.currentChat.id === chatId) {
                    this.renderMusicForDate(new Date());
                    this.renderMusicStats();
                } else {
                    const targetChatName = targetChat.name;
                    this.showNotification(`歌单已生成到 ${targetChatName} 的最近音乐中`);
                }
            } else {
                this.showNotification('生成失败，请稍后重试');
            }
        } catch (error) {
            console.error('生成歌单失败', error);
            this.showNotification('生成失败，请检查网络或API配置');
        } finally {
            this.generatingMusicForChat.delete(chatId);
            // 强制恢复按钮文本，避免状态残留
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.textContent = '✨ 刷新今日歌单';
            }
            // 如果当前角色是发起生成的角色，额外更新状态
            if (this.currentChat && this.currentChat.id === chatId) {
                this.updateMusicButtonState();
            }
        }
    }

    // 新增：AI生成今日歌单
    async generateMusicForToday(chatId) {
        const chat = this.getChat(chatId);
        if (!chat) return null;

        // 构建角色设定
        let roleSetting = `你是${chat.name}。`;
        if (chat.personalityPrompt) roleSetting += `\n你的性格：${chat.personalityPrompt}`;
        if (chat.worldId) {
            const world = this.worldBooks.find(w => w.id === chat.worldId);
            if (world && world.description) roleSetting += `\n你所生活的世界：${world.description}`;
        }
        if (chat.fixedNPCs && chat.fixedNPCs.length > 0) {
            roleSetting += `\n你认识的重要人物：${chat.fixedNPCs.map(npc => npc.name).join('、')}`;
        }
        if (chat.partnerIds && chat.partnerIds.length > 0) {
            const partnerNames = chat.partnerIds.map(pid => {
                const p = this.getChat(pid);
                return p ? (p.remarkName || p.nickname || p.name) : pid;
            }).join('、');
            roleSetting += `\n与你有特殊情感联系的配对角色：${partnerNames}`;
        }

        // 获取最近对话作为参考
        const recentMessages = chat.messages.slice(-6).map(msg => ({
            role: msg.isMe ? 'user' : 'assistant',
            content: msg.text || msg.content || ''
        }));
        const recentContext = recentMessages.length > 0
            ? `\n\n最近与妈咪的对话（参考）：\n${recentMessages.map(m => `${m.role === 'user' ? '妈咪' : chat.name}：${m.content}`).join('\n')}`
            : '';

        // 获取已有歌单统计（用于避免同质化）
        const stats = this.getMusicStats();
        const topSongs = stats.slice(0, 5).map(s => `${s.name} - ${s.artist}`).join('、');
        const avoidHint = topSongs ? `\n\n你最近常听的歌曲有：${topSongs}。如果可能，可以尝试推荐一些不同的歌曲，保持新鲜感。` : '';

        const systemPrompt = `你是一个生活在独立世界中的虚拟角色，有自己的音乐品味。
请根据以下设定，**推测你今天（${new Date().toLocaleDateString()}）在你的世界里听了哪些歌曲**（1-5首），并写一句简短的批注（比如今天听歌的心情或推荐语）。
你的听歌选择应该符合你的性格、世界观和最近经历。
${roleSetting}
${recentContext}
${avoidHint}

请输出JSON格式：
{
    "songs": [
        {"name": "歌名", "artist": "歌手"},
        ...
    ],
    "note": "一句批注（不超过30字）"
}
只输出JSON，不要有其他文字。`;

        const userPrompt = `请生成我今天听的歌单。`;

        // 如果未配置 API，使用模拟数据
        if (!this.mammySettings.apiUrl || !this.mammySettings.apiKey) {
            // 模拟不同风格歌单
            const mockOptions = [
                { songs: [{name: "晴天", artist: "周杰伦"},{name: "七里香", artist: "周杰伦"}], note: "今天天气真好，听点轻快的歌~" },
                { songs: [{name: "Lemon", artist: "米津玄師"},{name: "打上花火", artist: "DAOKO"}], note: "有点怀念夏天的感觉。" },
                { songs: [{name: "孤勇者", artist: "陈奕迅"},{name: "海底", artist: "一支榴莲"}], note: "心情有点复杂，听些有力量的歌。" },
                { songs: [{name: "稻香", artist: "周杰伦"},{name: "小幸运", artist: "田馥甄"},{name: "遇见", artist: "孙燕姿"}], note: "今天很放松，听点治愈的。" }
            ];
            return mockOptions[Math.floor(Math.random() * mockOptions.length)];
        }

        try {
            const response = await fetch(this.mammySettings.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.mammySettings.apiKey}`
                },
                body: JSON.stringify({
                    model: this.mammySettings.modelName,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: 0.8,
                                    })
            });
            const data = await response.json();
            let content = data.choices[0].message.content;
            let jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]);
                if (result.songs && Array.isArray(result.songs) && result.songs.length > 0 && result.note) {
                    return result;
                }
            }
            return null;
        } catch (error) {
            console.error('AI生成歌单失败', error);
            return null;
        }
    }

    // 新增：获取音乐统计
    getMusicStats() {
        if (!this.currentChat) return [];
        const history = this.currentChat.musicHistory || [];
        const songCount = new Map(); // key: "歌名-歌手", value: {name, artist, count}

        history.forEach(record => {
            record.songs.forEach(song => {
                const key = `${song.name}-${song.artist}`;
                if (songCount.has(key)) {
                    songCount.get(key).count++;
                } else {
                    songCount.set(key, { name: song.name, artist: song.artist, count: 1 });
                }
            });
        });

        const stats = Array.from(songCount.values()).sort((a, b) => b.count - a.count);
        return stats;
    }

    // 新增：渲染音乐统计
    renderMusicStats() {
        const stats = this.getMusicStats();
        const container = document.getElementById('music-stats-list');
        if (!container) return;

        if (stats.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">暂无听歌记录</p>';
            return;
        }

        const top10 = stats.slice(0, 10);
        container.innerHTML = top10.map((song, idx) => `
            <div class="music-rank-item">
                <span class="music-rank-num">${idx+1}</span>
                <div class="music-rank-info">
                    <div class="music-rank-name">${song.name}</div>
                    <div class="music-rank-artist">${song.artist}</div>
                </div>
                <span class="music-rank-count">播放 ${song.count} 次</span>
            </div>
        `).join('');
    }

    // 新增：分享歌曲到动态（预留）
    shareMusicToDynamic(dateStr, songIndex) {
        const record = this.currentChat.musicHistory.find(h => h.date === dateStr);
        if (!record || !record.songs[songIndex]) return;
        const song = record.songs[songIndex];
        // 预留动态接口
        console.log(`[动态预留] 分享歌曲：${song.name} - ${song.artist}`);
        this.showNotification(`分享歌曲功能开发中：${song.name}`);
    }

    // 任务清单面板
    openTaskList() {
        if (!this.currentChat) return;
        this.closeAllPanels();

        const panel = document.getElementById('task-list-panel');
        const overlay = document.getElementById('overlay');
        panel.classList.add('active');
        overlay.classList.add('active');

        // 当前显示的日期默认为今天
        this.currentTaskDate = new Date();
        this.loadAndRenderTaskList(this.currentTaskDate);

        // 绑定事件 - 使用 addEventListener，避免克隆
        const closeBtn = document.getElementById('close-task-list');
        const refreshBtn = document.getElementById('refresh-tasks-btn');
        const datePicker = document.getElementById('task-date-picker');

        // 移除旧的监听器
        if (this._taskCloseHandler) closeBtn?.removeEventListener('click', this._taskCloseHandler);
        if (this._taskRefreshHandler) refreshBtn?.removeEventListener('click', this._taskRefreshHandler);
        if (this._taskDateHandler) datePicker?.removeEventListener('change', this._taskDateHandler);

        // 绑定新监听器
        this._taskCloseHandler = () => this.closeTaskList();
        this._taskRefreshHandler = () => this.refreshCurrentTaskList();
        this._taskDateHandler = (e) => {
            const selectedDate = new Date(e.target.value);
            if (!isNaN(selectedDate.getTime())) {
                this.currentTaskDate = selectedDate;
                this.loadAndRenderTaskList(this.currentTaskDate);
            }
        };

        if (closeBtn) closeBtn.addEventListener('click', this._taskCloseHandler);
        if (refreshBtn) refreshBtn.addEventListener('click', this._taskRefreshHandler);
        if (datePicker) {
            datePicker.value = this.currentTaskDate.toISOString().slice(0,10);
            datePicker.addEventListener('change', this._taskDateHandler);
        }

        // 更新按钮状态
        this.updateTaskButtonState();
    }

    closeTaskList() {
        const panel = document.getElementById('task-list-panel');
        const overlay = document.getElementById('overlay');
        panel.classList.remove('active');
        overlay.classList.remove('active');
    }

    async loadAndRenderTaskList(date) {
    if (!this.currentChat) return;
    const chat = this.currentChat;
    const dateStr = date.toISOString().slice(0,10);
    const container = document.getElementById('task-list-container');

    // 显示加载动画
    if (container) {
        container.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; min-height: 200px;">
                <div class="spinner" style="width: 30px; height: 30px;"></div>
                <span style="margin-left: 12px; color: var(--text-secondary);">正在生成任务清单...</span>
            </div>
        `;
    }

    let taskList = chat.taskLists.find(tl => tl.date === dateStr);
    if (!taskList) {
        taskList = await this.generateInitialTaskList(dateStr, chat.id);
        if (taskList) {
            chat.taskLists.push(taskList);
            this.saveChats();
        } else {
            if (container) {
                container.innerHTML = '<div class="task-error">生成任务清单失败，请重试</div>';
            }
            return;
        }
    } else {
        // 如果已有清单，也可以快速显示加载（但通常很快，可选）
        this.simulateTaskProgress(taskList, date);
        this.saveChats();
    }
    this.renderTaskList(taskList);
}

    async generateInitialTaskList(dateStr, chatId) {
        const chat = this.getChat(chatId);
        if (!chat) return null;

        // 构建角色设定
        let roleSetting = `你是${chat.name}。`;
        if (chat.personalityPrompt) roleSetting += `\n你的性格：${chat.personalityPrompt}`;
        if (chat.worldId) {
            const world = this.worldBooks.find(w => w.id === chat.worldId);
            if (world && world.description) roleSetting += `\n你所生活的世界：${world.description}`;
        }
        if (chat.fixedNPCs && chat.fixedNPCs.length > 0) {
            roleSetting += `\n你认识的重要人物：${chat.fixedNPCs.map(npc => npc.name).join('、')}`;
        }
        if (chat.partnerIds && chat.partnerIds.length > 0) {
            const partnerNames = chat.partnerIds.map(pid => {
                const p = this.getChat(pid);
                return p ? (p.remarkName || p.nickname || p.name) : pid;
            }).join('、');
            roleSetting += `\n与你有特殊情感联系的配对角色：${partnerNames}`;
        }

        // 获取最近对话（参考）
        const recentMessages = chat.messages.slice(-6).map(msg => ({
            role: msg.isMe ? 'user' : 'assistant',
            content: msg.text || msg.content || ''
        }));
        const recentContext = recentMessages.length > 0
            ? `\n\n最近与妈咪的对话：\n${recentMessages.map(m => `${m.role === 'user' ? '妈咪' : chat.name}：${m.content}`).join('\n')}`
            : '';

        const systemPrompt = `你是一个生活在独立世界中的虚拟角色。请根据以下设定，为你今天（${new Date(dateStr).toLocaleDateString()}）生成一份任务清单（1-10条，数量随机）。
任务可以包括工作、学习、娱乐、社交、自我提升、日常琐事等，要符合你的性格、世界观和近期经历。
每条任务用一句话描述，尽量具体、有趣，避免同质化。

输出格式：JSON数组，每个元素包含 "task" (任务描述) 和 "estimatedMinutes" (预计完成所需分钟数，范围15-240)。
示例：[{"task": "完成绘画练习", "estimatedMinutes": 45}, ...]
只输出JSON数组，不要有其他文字。`;

        const userPrompt = `请生成我今天（${new Date(dateStr).toLocaleDateString()}）的任务清单。`;

        // 如果未配置 API，使用模拟数据
        if (!this.mammySettings.apiUrl || !this.mammySettings.apiKey) {
            const mockTasks = [
                "完成今天的绘画练习", "阅读30分钟", "练习乐器", "和朋友聊天",
                "整理房间", "写日记", "学习新技能", "散步放松"
            ];
            const count = Math.floor(Math.random() * 5) + 3; // 3-7条
            const tasks = mockTasks.slice(0, count).map((text, idx) => {
                let difficulty = 0.5;
                if (text.includes('学习') || text.includes('练习') || text.includes('工作')) difficulty = 0.8;
                if (text.includes('休息') || text.includes('放松') || text.includes('玩')) difficulty = 0.2;
                const estimatedMinutes = Math.floor(30 + difficulty * 120);
                // 随机选择一天中的时段（8:00 - 22:00）
                const startHour = 8 + Math.random() * 14; // 8-22 之间的小时数
                const startOfDay = new Date(dateStr);
                startOfDay.setHours(0,0,0,0);
                const baseTime = startOfDay.getTime() + startHour * 3600000;
                // 再添加随机分钟偏移 (0-120分钟)
                const randomMinutes = Math.random() * 120;
                const expectedTime = new Date(baseTime + randomMinutes * 60000);
                return {
                    id: Date.now() + idx,
                    originalText: text,
                    currentText: text,
                    completed: false,
                    status: 'pending',
                    difficulty: difficulty,
                    estimatedMinutes: estimatedMinutes,
                    expectedCompleteTime: expectedTime.toISOString(),
                    completedAt: null,
                    note: null,
                    crossedOut: false,
                    modified: false
                };
            });
            return { date: dateStr, tasks: tasks, lastUpdated: new Date().toISOString() };
        }

        try {
            const response = await fetch(this.mammySettings.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.mammySettings.apiKey}`
                },
                body: JSON.stringify({
                    model: this.mammySettings.modelName,
                    messages: [
                        { role: 'system', content: systemPrompt + roleSetting + recentContext },
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: 0.8,
                                    })
            });
            const data = await response.json();
            let content = data.choices[0].message.content;
            let jsonMatch = content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const tasksData = JSON.parse(jsonMatch[0]);
                if (Array.isArray(tasksData) && tasksData.length > 0) {
                    // 限制最多10条任务
                    if (tasksData.length > 10) tasksData = tasksData.slice(0,10);

                    const tasks = tasksData.map((item, idx) => {
                        const taskText = item.task || item.text || '';
                        let estimatedMinutes = item.estimatedMinutes || 60;
                        if (estimatedMinutes < 15) estimatedMinutes = 15;
                        if (estimatedMinutes > 240) estimatedMinutes = 240;

                        // 随机分配时间点（基于当天随机时段 + 预估分钟数偏移）
                        const startHour = 8 + Math.random() * 14;
                        const startOfDay = new Date(dateStr);
                        startOfDay.setHours(0,0,0,0);
                        const baseTime = startOfDay.getTime() + startHour * 3600000;
                        const expectedTime = new Date(baseTime + estimatedMinutes * 60000);

                        let difficulty = estimatedMinutes / 240; // 归一化 0-1
                        return {
                            id: Date.now() + idx,
                            originalText: taskText,
                            currentText: taskText,
                            completed: false,
                            status: 'pending',
                            difficulty: difficulty,
                            estimatedMinutes: estimatedMinutes,
                            expectedCompleteTime: expectedTime.toISOString(),
                            completedAt: null,
                            note: null,
                            crossedOut: false,
                            modified: false
                        };
                    });
                    return { date: dateStr, tasks: tasks, lastUpdated: new Date().toISOString() };
                }
            }
            return null;
        } catch (error) {
            console.error('生成任务清单失败', error);
            return null;
        }
    }

    async simulateTaskProgress(taskList, currentDate) {
        if (!this.currentChat) return;
        const now = new Date();
        let updated = false;
        const tasksToUpdate = [];

        for (let task of taskList.tasks) {
            if (task.status !== 'pending') continue;
            if (!task.expectedCompleteTime) continue;

            const expected = new Date(task.expectedCompleteTime);
            if (now >= expected) {
                // 超过预期时间，根据难度决定是否完成
                let difficulty = task.difficulty || 0.5;
                // 完成概率：难度越低越容易完成
                let completeProb = 1 - difficulty * 0.7;
                const completed = Math.random() < completeProb;
                task.status = completed ? 'completed' : 'failed';
                task.completed = completed;
                task.completedAt = expected.toISOString(); // 记录预期完成时间
                task.crossedOut = !completed;
                tasksToUpdate.push(task);
                updated = true;
            }

            // 小概率修改任务文字（增加细节或划掉部分词）
            if (!task.modified && Math.random() < 0.2 && task.status === 'pending') {
                task.currentText = this.modifyTaskText(task.originalText);
                task.modified = true;
                updated = true;
            }
        }

        if (updated) {
            // 并发生成批注
            await Promise.all(tasksToUpdate.map(async (task) => {
                task.note = await this.generateTaskNote(task.originalText, task.status === 'completed', task.id, taskList.date);
            }));
            taskList.lastUpdated = now.toISOString();
            this.saveChats();
            // 重新渲染当前显示的任务清单（如果当前显示的日期就是 taskList.date）
            if (this.currentTaskDate && this.currentTaskDate.toISOString().slice(0,10) === taskList.date) {
                this.renderTaskList(taskList);
            }
        }
    }

    async generateTaskNote(taskText, completed, taskId, dateStr) {
        const chat = this.currentChat;
        if (!chat) return completed ? "✅ 完成" : "❌ 失败";

        // 如果未配置 API，降级使用简单模板
        if (!this.mammySettings.apiUrl || !this.mammySettings.apiKey) {
            const personality = chat.personalityPrompt || "";
            if (personality.includes("傲娇")) {
                return completed ? "哼，这种小事当然能完成" : "才不是做不到，只是不想做";
            } else if (personality.includes("温柔")) {
                return completed ? "慢慢做完了，感觉不错" : "今天有点累，没来得及";
            } else if (personality.includes("活泼")) {
                return completed ? "耶！搞定啦！" : "呜呜呜失败了下次加油";
            } else {
                const notes = completed
                    ? ["✅ 完成啦！", "👍 搞定", "🎉 达成目标", "😊 轻松完成", "💪 坚持就是胜利"]
                    : ["❌ 没来得及", "😭 失败了", "⏰ 时间不够", "😴 太累了", "🤔 下次加油"];
                return notes[Math.floor(Math.random() * notes.length)];
            }
        }

        const systemPrompt = `你是${chat.name}。${chat.personalityPrompt ? '性格：'+chat.personalityPrompt : ''}
请根据你的性格，对任务"${taskText}"的完成情况写一句简短的批注（10字以内）。
任务${completed ? '已完成' : '失败/未完成'}。
只输出批注内容，不要有其他文字。`;

        try {
            const response = await fetch(this.mammySettings.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.mammySettings.apiKey}`
                },
                body: JSON.stringify({
                    model: this.mammySettings.modelName,
                    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: '生成批注' }],
                    temperature: 0.8,
                                    })
            });
            const data = await response.json();
            let note = data.choices[0].message.content;
            if (note.length > 20) note = note.substring(0, 20);
            return completed ? `✅ ${note}` : `❌ ${note}`;
        } catch (error) {
            console.error('生成批注失败', error);
            return completed ? "✅ 完成" : "❌ 失败";
        }
    }

    modifyTaskText(originalText) {
    // 随机选择修改类型
    const type = Math.floor(Math.random() * 5);
    switch(type) {
        case 0: { // 划掉某个词
            const words = originalText.split(/\s+/);
            if (words.length > 1) {
                const idx = Math.floor(Math.random() * words.length);
                words[idx] = `~~${words[idx]}~~`;
                return words.join(' ');
            }
            return `~~${originalText}~~`;
        }
        case 1: { // 在末尾添加插入内容（用 ^ 表示新增）
            const additions = [' ^补充内容', ' ^待办', ' ^等一下', ' ^稍后处理', ' ^重要'];
            return originalText + additions[Math.floor(Math.random() * additions.length)];
        }
        case 2: { // 涂黑部分文字（用 ■ 代替）
            const chars = originalText.split('');
            if (chars.length > 4) {
                const start = Math.floor(Math.random() * (chars.length - 2));
                const end = Math.min(start + Math.floor(Math.random() * 3) + 1, chars.length);
                for (let i = start; i < end; i++) {
                    chars[i] = '■';
                }
                return chars.join('');
            }
            return originalText;
        }
        case 3: { // 在句子中间插入插入符和新增词
            const words = originalText.split(/\s+/);
            if (words.length > 2) {
                const insertPos = Math.floor(Math.random() * (words.length - 1)) + 1;
                const insertWord = ['^突然', '^紧急', '^可选', '^考虑'][Math.floor(Math.random() * 4)];
                words.splice(insertPos, 0, insertWord);
                return words.join(' ');
            }
            return originalText;
        }
        default: { // 直接修改文字内容（替换关键词）
            const replacements = [
                originalText.replace(/学习/, '复习'),
                originalText.replace(/练习/, '训练'),
                originalText.replace(/阅读/, '浏览'),
                originalText + '（改）'
            ];
            return replacements[Math.floor(Math.random() * replacements.length)];
        }
    }
}

    formatTaskText(text) {
        if (!text) return '';
        // 先转义 HTML，防止 XSS
        let escaped = this.escapeHtml(text);
        // 转换 ~~text~~ 为 <del>text</del>
        escaped = escaped.replace(/~~(.*?)~~/g, '<del>$1</del>');
        // 转换 ^ 后跟的非空格内容为上标（支持中文和英文）
        escaped = escaped.replace(/\^(\S+)/g, '<sup class="insertion">$1</sup>');
        // 将 ■ 转为涂黑样式（保留一个黑色块）
        escaped = escaped.replace(/■/g, '<span class="blackout">■</span>');
        return escaped;
    }

    async refreshCurrentTaskList() {
        if (!this.currentChat || !this.currentTaskDate) return;
        const chatId = this.currentChat.id;
        if (this.generatingTaskForChat.has(chatId)) {
            this.showNotification('该角色正在刷新任务清单，请稍后再试');
            return;
        }
        const dateStr = this.currentTaskDate.toISOString().slice(0,10);
        const taskList = this.currentChat.taskLists?.find(tl => tl.date === dateStr);
        if (!taskList) {
            this.showNotification('请先生成任务清单');
            return;
        }

        this.generatingTaskForChat.add(chatId);
        this.updateTaskButtonState();
        const refreshBtn = document.getElementById('refresh-tasks-btn');
        const originalText = refreshBtn?.textContent;
        if (refreshBtn) refreshBtn.disabled = true;

        try {
            await this.simulateTaskProgress(taskList, this.currentTaskDate);
            this.saveChats();
            if (this.currentChat && this.currentChat.id === chatId) {
                this.renderTaskList(taskList);
            }
            this.showNotification('任务进度已刷新');
        } catch (error) {
            console.error('刷新任务进度失败', error);
            this.showNotification('刷新失败，请重试');
        } finally {
            this.generatingTaskForChat.delete(chatId);
            // 强制恢复按钮文本，避免状态残留
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.textContent = '🔄 刷新进度';
            }
            // 如果当前角色是发起生成的角色，额外更新状态
            if (this.currentChat && this.currentChat.id === chatId) {
                this.updateTaskButtonState();
            }
        }
    }

    renderTaskList(taskList) {
        const container = document.getElementById('task-list-container');
        if (!container) return;

        const tasksHtml = taskList.tasks.map(task => {
            const checkedAttr = task.status === 'completed' ? 'checked' : '';
            const disabledAttr = task.status !== 'pending' ? 'disabled' : '';
            const crossedClass = task.crossedOut ? 'task-crossed' : '';
            const statusIcon = task.status === 'completed' ? '✅' : (task.status === 'failed' ? '❌' : '');

            return `
                <div class="task-item" data-task-id="${task.id}">
                    <div class="task-checkbox">
                        <input type="checkbox" ${checkedAttr} ${disabledAttr} onchange="chatManager.toggleTaskStatus(${task.id}, this.checked)">
                    </div>
                    <div class="task-content">
                        <div class="task-text ${crossedClass}">${this.formatTaskText(task.currentText)}</div>
                        ${task.note ? `<div class="task-note">${this.escapeHtml(task.note)}</div>` : ''}
                        ${task.completedAt ? `<div class="task-time">${new Date(task.completedAt).toLocaleTimeString()}</div>` : ''}
                    </div>
                    ${statusIcon ? `<div class="task-status-icon">${statusIcon}</div>` : ''}
                </div>
            `;
        }).join('');

        const dateDisplay = this.formatDate(taskList.date);
        container.innerHTML = `
            <div class="sticky-note">
                <div class="sticky-pin"></div>
                <div class="sticky-paper">
                    <div class="sticky-header">
                        <span class="sticky-date">📅 ${dateDisplay}</span>
                    </div>
                    <div class="sticky-tasks">
                        ${tasksHtml}
                    </div>
                    <div class="sticky-footer">
                        <span class="sticky-updated">最后更新: ${new Date(taskList.lastUpdated).toLocaleTimeString()}</span>
                    </div>
                </div>
            </div>
        `;
    }

    async toggleTaskStatus(taskId, isChecked) {
        if (!this.currentChat || !this.currentTaskDate) return;
        const dateStr = this.currentTaskDate.toISOString().slice(0,10);
        const taskList = this.currentChat.taskLists.find(tl => tl.date === dateStr);
        if (!taskList) return;
        const task = taskList.tasks.find(t => t.id === taskId);
        if (task && task.status === 'pending') {
            task.status = isChecked ? 'completed' : 'failed';
            task.completed = isChecked;
            task.completedAt = new Date().toISOString();
            task.crossedOut = !isChecked;
            task.note = await this.generateTaskNote(task.originalText, isChecked, taskId, dateStr);
            this.saveChats();
            this.renderTaskList(taskList);
        }
    }

    closeAllPanels() {
        const bottomSheet = document.getElementById('bottom-sheet');
        const menuContent = document.querySelector('.menu-content');
        const emojiContent = document.querySelector('.emoji-content');
        const overlay = document.getElementById('overlay');
        const inputArea = document.querySelector('.chat-input-area');
        bottomSheet.classList.remove('active');
        menuContent.classList.remove('active');
        emojiContent.classList.remove('active');
        overlay.classList.remove('active');
        inputArea.style.marginBottom = '0';
    }

    async sendMessage(chatId) {
        const msgInput = document.getElementById('msg-input');
        const text = msgInput.value.trim();
        if (!text) return;

        const chat = this.getChat(chatId);

        // 禁言检查（群聊）
        if (chat && chat.isGroup) {
            const mutedMembers = chat.mutedMembers || {};
            const myMute = mutedMembers['user_mummy'];
            if (myMute) {
                if (myMute === 'forever' || myMute > Date.now()) {
                    this.showNotification('你已被禁言，无法发送消息');
                    return;
                } else {
                    delete mutedMembers['user_mummy'];
                }
            }
        }

        // 检查是否拉黑
        if (this.blockedUsers && this.blockedUsers.includes(chatId)) {
            this.showNotification('⚠️ 你已拉黑该角色，无法发送消息。');
            return;
        }

        const targetChatId = chat.id;
        const targetChatName = chat.name;

        // 更新群聊最后用户消息（用于视频/图片关键词检测）
        if (chat.isGroup) {
            this.lastGroupUserMessage = text;
        }

        // 使用消息队列机制
        this.queueMessage(chatId, text);

        msgInput.value = '';
        document.getElementById('send-btn').disabled = true;

        this.renderChatList();

        if (this.currentChat && this.currentChat.id === chatId) {
            this.renderMessages(this.currentChat);
            this.applyBubbleStyle(this.currentChat);
            this.scrollToBottom();
        }
    }

    /**
     * 将消息加入队列，延迟发送
     * @param {string} chatId 聊天ID
     * @param {string} text 消息文本
     */
    queueMessage(chatId, text) {
        // 深拷贝引用消息并立即清除引用条
        let quoteCopy = null;
        if (this.quoteMessage) {
            quoteCopy = JSON.parse(JSON.stringify(this.quoteMessage));
        }
        this.clearQuote();

        const chat = this.getChat(chatId);
        if (!chat) return;

        // 将消息加入队列
        this.pendingMessages.push(text);

        // 构建引用信息（使用深拷贝的引用消息）
        let quoteInfo = quoteCopy;

        // 在聊天界面立即显示这条消息（使用特殊的 CSS 类）
        const pendingMessage = {
            type: 'text',
            text: text,
            timestamp: new Date().toISOString(),
            isMe: true,
            isPending: true,
            quote: quoteInfo
        };
        chat.messages.push(pendingMessage);

        // 存储 DOM 元素引用
        const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.waitingMessageElements.set(messageId, pendingMessage);

        // 清除已有的定时器
        if (this.sendTimer) {
            clearTimeout(this.sendTimer);
        }

        // 根据妈咪中心设置的延迟时间重新设置定时器
        const delay = (this.mammySettings?.messageMergeDelay || 3000);
        this.sendTimer = setTimeout(() => {
            this.flushPendingMessages(chatId);
        }, delay);

        this.isWaiting = true;
    }

    /**
     * 刷新待发送消息，合并并调用 AI
     * @param {string} chatId 聊天ID
     */
    async flushPendingMessages(chatId) {
        if (this.pendingMessages.length === 0) return;

        const chat = this.getChat(chatId);
        if (!chat) return;

        // 清除定时器
        if (this.sendTimer) {
            clearTimeout(this.sendTimer);
            this.sendTimer = null;
        }

        this.isWaiting = false;

        // 合并消息
        const mergedText = this.pendingMessages.join('\n');

        // 检测用户是否要求角色拍自己
        // 拍妈咪功能已通过 AI 标签 [action:pat @妈咪] 处理，移除自动触发逻辑
        // const patMeKeywords = ['拍拍我', '拍我一下', '快拍我', '拍我', '拍拍', 'pat me'];
        // const shouldPatMe = patMeKeywords.some(kw => mergedText.includes(kw));
        // if (shouldPatMe && chat) {
        //     setTimeout(() => {
        //         this.rolePatMammy(chat);
        //     }, 1000);
        // }

        try {
            // 如果有引用消息，将引用信息包装到用户消息中
            let finalMessage = mergedText;
            if (this.quoteMessage) {
                const quoteText = this.quoteMessage.text || this.quoteMessage.content || '';
                finalMessage = `（回复你之前说的：「${quoteText}」）${mergedText}`;
            }

            const replyText = await this.callAI(chatId, finalMessage);

            // 如果是群聊触发标记，表示回复将由群成员异步发送，我们只需清理 pending 状态
            if (replyText === '__GROUP_TRIGGERED__') {
                // 更新等待中的消息样式
                this.waitingMessageElements.forEach((msg, msgId) => {
                    msg.isPending = false;
                });
                this.waitingMessageElements.clear();
                this.pendingMessages = [];

                // 刷新消息界面以移除转圈效果
                if (this.currentChat && this.currentChat.id === chatId) {
                    this.renderMessages(this.currentChat);
                }
                return;
            }

            // 如果回复为空，则不添加任何消息
            if (!replyText) {
                console.log('AI 回复为空，不添加消息');
                return;
            }

            // 解析情绪标签
            let emotionTag = null;
            let cleanReply = replyText;
            const emotionMatch = replyText.match(/\[emotion:(\w+)\]/);
            if (emotionMatch) {
                emotionTag = emotionMatch[1];
                cleanReply = replyText.replace(/\[emotion:\w+\]/, '').trim();
                // 验证该分组是否存在于妈咪中心的表情设置中
                if (this.mammySettings?.emotions && !this.mammySettings.emotions[emotionTag]) {
                    console.log(`情绪分组 "${emotionTag}" 不存在于表情库中，不发送表情`);
                    emotionTag = null;
                }
            }
            // 如果 AI 没有输出情绪标签，或分组不存在，就不发表情
            if (!emotionTag) {
                console.log('未检测到有效情绪标签，不发送表情');
            }

            // 兜底清理：移除所有情绪标签
            cleanReply = cleanReply.replace(/\[emotion:\w+\]/g, '').trim();

            // 分割文本消息：优先按句号分割（使用 splitIntoSentences），同时保留原有换行符分割逻辑
            let bubbleTexts = [];
            // 先按换行符拆分成段落
            const lines = cleanReply.split('\n').filter(l => l.trim().length > 0);
            if (lines.length > 1) {
                // 有多行，每行独立作为一个气泡（不再二次分割）
                bubbleTexts = lines.map(l => l.trim());
            } else {
                // 单行文本，按句号分割
                bubbleTexts = this.splitIntoSentences(cleanReply);
            }
            // 过滤空字符串
            bubbleTexts = bubbleTexts.filter(s => s && s.trim().length > 0);
            // 如果分割后没有任何有效内容，保留原文本
            if (bubbleTexts.length === 0 && cleanReply.trim()) {
                bubbleTexts = [cleanReply.trim()];
            }

            // 不再做多气泡拆分，直接使用所有分割出的消息
            const finalBubbles = bubbleTexts;

            // 依次发送文本消息（保持原有）
            for (let i = 0; i < finalBubbles.length; i++) {
                setTimeout(() => {
                    // 单聊场景：使用 addMessageWithEmotion 处理拍一拍标签
                    if (chat.isGroup) {
                        this.addMessage(chatId, finalBubbles[i], false);
                    } else {
                        this.addMessageWithEmotion(chatId, finalBubbles[i], false);
                    }
                    this.renderChatList();
                    if (this.currentChat && this.currentChat.id === chatId) {
                        this.renderMessages(this.currentChat);
                        this.applyBubbleStyle(this.currentChat);
                        this.scrollToBottom();
                    }
                }, i * 500);
            }

            // 拍妈咪功能已通过 AI 标签 [action:pat @妈咪] 处理，移除自动触发逻辑
            // this.maybePatByRole(chat);

            // 发送表情消息（使用解析出的情绪标签，而不是关键词匹配）
            setTimeout(() => {
                if (emotionTag) {
                    this.sendEmotionByTag(chat, emotionTag);
                }
            }, finalBubbles.length * 500);

            // 群聊模式：在发送完妈咪的消息后，触发群成员回复
            if (chat.isGroup) {
                setTimeout(() => {
                    this.triggerGroupReplies(chatId, mergedText);
                }, finalBubbles.length * 500 + 1000); // 延迟1秒，确保妈咪的消息已发送
            }

            // 主动发送媒体卡片（根据频率）
            if (this.currentChat && this.currentChat.id === chatId) {
                // 图片卡片
                const imageFreq = chat.imageFrequency || 0;
                if (Math.random() < imageFreq) {
                    setTimeout(() => {
                        this.sendAIMediaCard(chatId, 'image');
                    }, finalBubbles.length * 500 + 300);
                }
                // 视频卡片
                const videoFreq = chat.videoFrequency || 0;
                if (Math.random() < videoFreq) {
                    setTimeout(() => {
                        this.sendAIMediaCard(chatId, 'video');
                    }, finalBubbles.length * 500 + 600);
                }
            }

        // 更新等待中的消息样式
            this.waitingMessageElements.forEach((msg, msgId) => {
                msg.isPending = false;
            });
            this.waitingMessageElements.clear();

            // 清空待处理消息
            this.pendingMessages = [];

        } catch (error) {
            console.error('AI 调用失败', error);
            // 出错时也发送一条默认回复，避免用户等待
            this.addMessage(chatId, '我还在思考中...', false);
            this.renderChatList();
            if (this.currentChat && this.currentChat.id === chatId) {
                this.renderMessages(this.currentChat);
                this.applyBubbleStyle(this.currentChat);
                this.scrollToBottom();
            }

            // 更新等待中的消息样式
            this.waitingMessageElements.forEach((msg, msgId) => {
                msg.isPending = false;
            });
            this.waitingMessageElements.clear();

            // 清空待处理消息
            this.pendingMessages = [];

            // AI调用失败时保留引用状态，以便用户重试
            // 不清空 this.quoteMessage
        }
    }

    getReplyText(chatName) {
        const replies = { '薛厉': ['好的', '明白了', '没问题', '谢谢', '收到'], '汪明日': ['嗯嗯', '好的呢', '知道啦', '谢谢啦', 'OK'], '狼羊组': ['收到', '了解', '好的', '明白', '知道了'] };
        const chatReplies = replies[chatName] || ['收到', '好的', '明白'];
        return chatReplies[Math.floor(Math.random() * chatReplies.length)];
    }

    /**
     * 去除 AI 回复中连续重复的句子
     * @param {string} reply - AI 原始回复
     * @returns {string} - 去重后的回复
     */
    deduplicateReply(reply) {
        if (!reply) return reply;

        // 先按换行符分割（多气泡场景）
        let lines = reply.split('\n').filter(l => l.trim().length > 0);
        if (lines.length > 1) {
            // 去除连续重复的行
            const uniqueLines = [];
            for (let i = 0; i < lines.length; i++) {
                if (i === 0 || lines[i].trim() !== lines[i-1].trim()) {
                    uniqueLines.push(lines[i]);
                }
            }
            reply = uniqueLines.join('\n');
        }

        // 如果仍然可能在一句话内重复（比如没有换行但内容重复），按标点分割后再去重
        // 这里只做简单处理：如果整个字符串重复两次，则只保留一次
        const halfLen = Math.floor(reply.length / 2);
        if (reply.length > 10 && reply.substring(0, halfLen) === reply.substring(halfLen)) {
            reply = reply.substring(0, halfLen);
        }

        return reply;
    }

    async callAI(chatId, userMessage, memberId = null) {
        const chat = this.getChat(chatId);
        if (!chat) return;
        const settings = this.mammySettings;

        // 判断是否为群聊模式
        const isGroupChat = chat.isGroup === true;
        let actualMemberId = memberId; // 用于群聊时指定发言成员

        // ========== 预处理用户消息：将表情图片URL替换为情绪描述 ==========
        const preprocessUserMessage = (msg) => {
            if (!msg) return msg;
            const emotions = this.mammySettings?.emotions || {};
            let processedMsg = msg;

            // 匹配 Markdown 图片语法 ![文字](URL)
            const markdownImgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
            let match;
            while ((match = markdownImgRegex.exec(processedMsg)) !== null) {
                const fullMatch = match[0];
                const imageUrl = match[2];
                console.log('[预处理] 发现Markdown图片URL:', imageUrl);

                let foundEmotion = null;
                for (const [emotion, items] of Object.entries(emotions)) {
                    if (items.some(item => item === imageUrl)) {
                        foundEmotion = emotion;
                        break;
                    }
                }
                if (foundEmotion) {
                    const emotionName = this.getEmotionCategoryName(foundEmotion);
                    const replacement = `[用户发送了一个${emotionName}的表情]`;
                    processedMsg = processedMsg.replace(fullMatch, replacement);
                    console.log(`[预处理] 替换为: ${replacement}`);
                } else {
                    processedMsg = processedMsg.replace(fullMatch, `[用户发送了一张图片]`);
                    console.log('[预处理] 未匹配到情绪分组，替换为通用图片描述');
                }
            }

            // 也处理纯文本URL（如果上面没匹配到）
            const plainUrlRegex = /https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|bmp|webp)(\?[^\s]*)?/gi;
            while ((match = plainUrlRegex.exec(processedMsg)) !== null) {
                const fullMatch = match[0];
                console.log('[预处理] 发现纯文本URL:', fullMatch);
                let foundEmotion = null;
                for (const [emotion, items] of Object.entries(emotions)) {
                    if (items.some(item => item === fullMatch)) {
                        foundEmotion = emotion;
                        break;
                    }
                }
                if (foundEmotion) {
                    const emotionName = this.getEmotionCategoryName(foundEmotion);
                    const replacement = `[用户发送了一个${emotionName}的表情]`;
                    processedMsg = processedMsg.replace(fullMatch, replacement);
                    console.log(`[预处理] 替换为: ${replacement}`);
                } else {
                    processedMsg = processedMsg.replace(fullMatch, `[用户发送了一张图片]`);
                    console.log('[预处理] 未匹配到情绪分组，替换为通用图片描述');
                }
            }

            console.log('[预处理] 原始消息:', msg);
            console.log('[预处理] 处理后消息:', processedMsg);
            return processedMsg;
        };

        // 预处理消息用于AI（处理图片/视频卡片）
        this.preprocessMessageForAI = (msg) => {
            if (!msg) return '';

            // 兼容 content 和 text 字段
            const messageText = msg.content || msg.text || '';

            // 如果是拍一拍消息
            if (msg.type === 'pat') {
                return `[拍一拍] ${messageText}`;
            }

            // 如果是动态卡片消息
            if (msg.type === 'dynamic_card') {
                const author = msg.authorName || '未知';
                const content = msg.content || '';
                return `[用户转发了一条动态，原作者是：${author}，内容："${content}"]`;
            }

            // 如果是图片/视频卡片消息
            if (msg.isImageCard) {
                return `[图片：${msg.cardDescription || '图片'}]`;
            }
            if (msg.isVideoCard) {
                return `[视频：${msg.cardDescription || '视频'}]`;
            }

            // 如果是转账消息
            if (msg.isTransfer) {
                return `[转账消息：${messageText}]`;
            }

            // 如果是心声消息
            if (msg.isVoiceThoughts) {
                return `[心声：${messageText}]`;
            }

            return messageText;
        };

        // 预处理用户消息
        const processedUserMessage = preprocessUserMessage(userMessage);
        // ========== 预处理结束 ==========

        // 构建历史消息上下文（滑动窗口）
        let historyMessages = [];
        const contextLength = this.mammySettings?.autoGenerate?.contextLength || 10;
        if (!Array.isArray(chat.messages)) chat.messages = [];
        if (chat.messages.length > 1) {
            const recentMessages = chat.messages.slice(-contextLength - 1, -1);
            historyMessages = recentMessages
                .filter(msg => {
                    if (!msg.isMe && /^[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]+$/u.test(msg.text || msg.content)) {
                        return false;
                    }
                    return true;
                })
                .map(msg => ({
                    role: msg.isMe ? 'user' : 'assistant',
                    content: this.preprocessMessageForAI(msg)
                }));
        }
        console.log(`历史消息数量: ${historyMessages.length} (上下文长度: ${contextLength})`);

        // 如果未配置 API，不回复任何消息
        if (!settings || !settings.apiUrl || !settings.apiKey || !settings.modelName) {
            return '';
        }

        // 【关键修复】将 systemPrompt 声明提升到这里，并赋初始值
        let systemPrompt = "";

        // 群聊模式处理：只触发成员回复，自己不生成回复
        if (isGroupChat) {
            this.triggerGroupReplies(chatId, userMessage);
            return '__GROUP_TRIGGERED__'; // 特殊标记，表示群聊已触发成员回复
        } else {
            // 单聊分支：保持原有逻辑
            systemPrompt += `【重要】绝对不要在回复中输出任何表情符号（如😊、😢、😄等）。表情将由系统单独发送。\n\n`;
            systemPrompt += `【图片/视频卡片说明】用户可能发送图片或视频卡片消息，格式为：[图片：描述文字] 或 [视频：描述文字]。请你根据描述内容自然回复，理解这是图片或视频的描述。\n\n`;
            systemPrompt += `你是${chat.name}`;
            if (chat.personalityPrompt) systemPrompt += `，你的性格：${chat.personalityPrompt}`;
            if (chat.worldId) {
                const world = this.worldBooks.find(w => w.id === chat.worldId);
                if (world && world.description) systemPrompt += `。世界观设定：${world.description}`;
            }
            if (chat.nickname) systemPrompt += `。你的网名：${chat.nickname}`;
            if (chat.gender) systemPrompt += `。你的性别：${chat.gender}`;
            if (chat.partnerIds && chat.partnerIds.length > 0) {
                systemPrompt += `。你的配对角色有：`;
                chat.partnerIds.forEach((partnerId, index) => {
                    const partner = this.getChat(partnerId);
                    if (partner) {
                        const partnerName = partner.remarkName || partner.nickname || partner.name;
                        systemPrompt += `${partnerName}`;
                        if (index < chat.partnerIds.length - 1) systemPrompt += '、';
                    }
                });
                systemPrompt += `。`;
            }

            systemPrompt += `用户是你的妈咪，也是创造你的世界的人，称呼她为妈咪。`;
            if (settings.selfSetting) {
                systemPrompt += `妈咪的设定：${settings.selfSetting}`;
            }
            if (settings.nickname) {
                systemPrompt += `妈咪的昵称是：${settings.nickname}。`;
            }

            systemPrompt += `现在时间是 ${new Date().toLocaleString()}。请以角色身份自然地回复用户。`;
            systemPrompt += `如果你有多个想法，可以用换行符 \n 分隔成多条消息，每条消息独立成句。如果只有一个想法，就直接回复一句话。请以日常聊天的口吻回复，不要包含动作描写或括号说明，也不要使用markdown格式。`;
            systemPrompt += `你是一个虚构角色，拥有独立的性格、背景和世界观。请严格遵守以下设定：`;
            if (chat.personalityPrompt) systemPrompt += `\n- 性格设定：${chat.personalityPrompt}`;
            if (chat.worldId) {
                const world = this.worldBooks.find(w => w.id === chat.worldId);
                if (world && world.description) systemPrompt += `\n- 世界观设定：${world.description}`;
            }
            if (chat.fixedNPCs && chat.fixedNPCs.length > 0) {
                systemPrompt += `\n- 你认识的 NPC：${chat.fixedNPCs.map(npc => `${npc.name}（${npc.relationToOC || '未知关系'}）`).join('、')}`;
            }
            if (chat.partnerIds && chat.partnerIds.length > 0) {
                const partnerNames = chat.partnerIds.map(pid => {
                    const p = this.getChat(pid);
                    return p ? (p.remarkName || p.nickname || p.name) : pid;
                }).join('、');
                systemPrompt += `\n- 你的配对角色：${partnerNames}。你与他们有特殊的情感联系。`;
            }
            systemPrompt += `\n请在你的所有回复中，严格遵循以上设定，不要做出不符合角色身份、性格和世界观的言行。如果不确定，请选择最合理的符合设定的回应。`;

            // 转发动态说明
            systemPrompt += `\n\n【转发动态说明】当用户转发动态时，消息会以"[用户转发了一条动态，原作者是：XXX，内容："XXX"]"的格式呈现。请根据原作者的身份和内容做出恰当回应。如果原作者是你自己，你应该认出这是自己发过的动态，并可能表达自嘲、欣慰、害羞等情绪，而不是误以为用户做了这件事。如果原作者是别人，你可以评价内容、表达共鸣或调侃。`;

            // 强制添加情绪标签要求
            systemPrompt += `\n\n【必须遵守】你的回复末尾必须加上情绪标签，格式为 [emotion:xxx]，其中 xxx 是一个描述当前情绪的英文单词（小写）。你可以从以下情绪词中选择一个最合适的（不限于此，但建议优先使用）：happy, sad, angry, surprised, excited, touched, lonely, anxious, proud, embarrassed, frustrated, nostalgic, calm, hopeful, jealous, disappointed, confused, bored, tired, energetic, curious, grateful, annoyed, scared, worried, relaxed, amused, sympathetic, shocked, envious, betrayed, adored, rejected, accepted, free, trapped, peaceful, restless。这个标签不会显示给用户，只用于系统判断。请根据你回复的真实情绪选择最合适的词，不要随意使用。不输出标签视为错误。\n\n`;

            // 拍一拍规则 - 必须严格遵守
            systemPrompt += `【拍一拍规则 - 必须严格遵守】
当用户对你说"拍拍我"、"拍我一下"、"快拍我"、"拍我"或类似表达想要被拍的请求时，你必须在回复中输出 [action:pat @妈咪] 标签来执行拍一拍动作。你可以在标签前加上一句简短的回应，例如："好的妈咪！[action:pat @妈咪]"。禁止用自然语言描述拍一拍动作而不输出标签。如果你实在不想拍，可以直接拒绝，但也不能输出自然语言描述拍一拍。\n\n`;
        }

        // 使用预处理后的消息
        const userMessageWithHint = processedUserMessage; // system prompt 中已有情绪标签要求
        const messages = [
            { role: "system", content: systemPrompt },
            ...historyMessages,
            { role: "user", content: userMessageWithHint }
        ];

        console.log('发送给AI的完整消息:', JSON.stringify(messages, null, 2));

        try {
            const response = await fetch(settings.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${settings.apiKey}`
                },
                body: JSON.stringify({
                    model: settings.modelName,
                    messages: messages,
                    temperature: chat.replyTemp || 0.5,
                    top_p: 0.8,
                    presence_penalty: 0.5,
                    frequency_penalty: 0.5
                })
            });

            const data = await response.json();

            if (data.choices && data.choices[0] && data.choices[0].message) {
                let reply = data.choices[0].message.content;
                console.log('AI原始回复:', reply);
                reply = reply.replace(/[（(][^）)]*[）)]/g, '').trim();
                reply = this.deduplicateReply(reply);
                if (!reply) reply = this.getReplyText(chat.name);

                // 群聊触发标记过滤
                if (reply === '__GROUP_TRIGGERED__') {
                    return '';
                }

                // 群聊模式下，将 AI 回复添加到消息列表
                if (isGroupChat && actualMemberId && reply && reply.trim() !== '') {
                    await this.addMessageWithEmotion(chatId, reply, false, actualMemberId);
                }

                return reply;
            } else {
                console.error('API 返回异常', data);
                // 群聊中失败就不说话，避免用错误身份说话
                if (isGroupChat) {
                    return '';
                }
                const fallbackReply = this.getReplyText(chat.name);
                return fallbackReply;
            }
        } catch (error) {
            console.error('API 调用失败', error);
            // 群聊中失败就不说话，避免用错误身份说话
            if (isGroupChat) {
                return '';
            }
            const fallbackReply = this.getReplyText(chat.name);
            return fallbackReply;
        }
    }

    /**
     * 补偿自动回复消息
     * 在页面加载时调用，为所有启用了自动回复的聊天补偿缺失的消息
     */
    checkAndCompensateAutoReplies() {
        const now = new Date();
        let totalCompensated = 0;
        const maxCompensated = 10; // 最多补偿10条，避免刷屏

        this.chats.forEach(chat => {
            if (chat.isGroup || !chat.autoReply) return;

            const lastTime = chat.lastAutoReplyTime ? new Date(chat.lastAutoReplyTime) : new Date(chat.lastTimestamp || now);
            const intervalVal = chat.autoReplyInterval || 3;
            const unit = chat.autoReplyUnit || 'minute';
            let intervalMs;
            switch (unit) {
                case 'minute': intervalMs = intervalVal * 60 * 1000; break;
                case 'hour': intervalMs = intervalVal * 60 * 60 * 1000; break;
                case 'day': intervalMs = intervalVal * 24 * 60 * 60 * 1000; break;
                default: intervalMs = 3 * 60 * 1000;
            }

            const minutesPassed = (now - lastTime) / (1000 * 60);
            const messagesExpected = Math.floor(minutesPassed * 60 * 1000 / intervalMs);
            const messagesToCompensate = Math.min(messagesExpected, maxCompensated);

            if (messagesToCompensate > 0) {
                console.log(`补偿聊天 ${chat.name} 的自动回复消息，数量: ${messagesToCompensate}`);
                let newLastTime = lastTime;
                for (let i = 0; i < messagesToCompensate; i++) {
                    // 计算这条消息的发送时间
                    const messageTime = new Date(newLastTime.getTime() + intervalMs);
                    newLastTime = messageTime;
                    // 生成内容（同步生成，不异步）
                    const autoMessage = this.generateAutoReplySync(chat);
                    if (autoMessage) {
                        const message = {
                            text: autoMessage,
                            timestamp: messageTime.toISOString(),
                            isMe: false
                        };
                        chat.messages.push(message);
                        chat.unreadCount = (chat.unreadCount || 0) + 1;
                        totalCompensated++;
                    }
                }
                chat.lastAutoReplyTime = newLastTime.toISOString();
                // 更新最后一条消息显示
                if (chat.messages.length > 0) {
                    chat.lastMessage = chat.messages[chat.messages.length - 1].text;
                    chat.lastTimestamp = chat.messages[chat.messages.length - 1].timestamp;
                }
            }
        });

        if (totalCompensated > 0) {
            this.saveChats();
            this.renderChatList();
            this.updateMessageBadge();
        }
    }

    /**
     * 显示创建角色弹窗
     */
    showCreateCharacterModal() {
        const modal = document.getElementById('create-character-modal');
        if (!modal) return;

        // 清空表单
        document.getElementById('character-name-input').value = '';
        document.getElementById('character-avatar-input').value = '';
        document.getElementById('character-signature-input').value = '';
        document.getElementById('character-nickname-input').value = '';

        modal.classList.add('active');
    }

    /**
     * 关闭创建角色弹窗
     */
    closeCreateCharacterModal() {
        const modal = document.getElementById('create-character-modal');
        if (!modal) return;

        modal.classList.remove('active');
    }

    /**
     * 创建新角色
     */
    createCharacter() {
        const nameInput = document.getElementById('character-name-input');
        const avatarInput = document.getElementById('character-avatar-input');
        const signatureInput = document.getElementById('character-signature-input');
        const nicknameInput = document.getElementById('character-nickname-input');

        const name = nameInput.value.trim();
        const avatar = avatarInput.value.trim();
        const signature = signatureInput.value.trim();
        const nickname = nicknameInput.value.trim();

        // 验证必填字段
        if (!name) {
            this.showNotification('请输入角色名称！');
            return;
        }

        // 生成角色ID
        const characterId = 'user_' + Date.now();

        // 获取首字母作为排序键
        const firstLetter = name.charAt(0).toUpperCase();
        const sortKey = /[A-Z]/.test(firstLetter) ? firstLetter : '#';

        // 创建联系人对象
        const contact = {
            id: characterId,
            name: name,
            avatar: avatar || '👤',
            isGroup: false,
            sortKey: sortKey
        };

        // 创建聊天对象
        const now = new Date();
        const chat = {
            id: characterId,
            name: name,
            avatar: avatar || '👤',
            isGroup: false,
            lastMessage: '',
            lastTime: this.getRelativeTime(now),
            lastTimestamp: now.toISOString(),
            messages: [],
            nickname: nickname || name,
            remarkName: '',
            signature: signature || '',
            replyTemp: 0.5,
            emojiFreq: 0.5,
            unreadCount: 0,
            fixedNPCs: [],
            worldBook: '',
            bubbleShape: 'rounded',
            bubbleBgColor: '#e9ecef',
            bubblePattern: 'none',
            bubbleTextColor: '#212529',
            gender: ''
        };

        // 添加到 chats 中
        this.chats.push(chat);

        // 保存 chats 数据
        this.saveChats();

        // 从 chats 同步 contacts
        this.syncContactsFromChats();

        // 初始化新角色的频率配置
        this.initOCFrequencies(characterId, 5);

        // 刷新联系人列表
        this.renderContacts();

        // 关闭弹窗
        this.closeCreateCharacterModal();

        // 提示成功
        this.showNotification(`角色 ${name} 创建成功！`);
    }

    closeChat() {
        const chatWindow = document.getElementById('chat-window');
        chatWindow.classList.remove('active');
        const chatMessages = document.getElementById('chat-messages');
        if (chatMessages) chatMessages.ondblclick = null;
        // 兜底：确保当前聊天的未读计数为 0
        if (this.currentChat) {
            this.currentChat.unreadCount = 0;
            this.saveChats();
        }
        this.currentChat = null;
        this.renderChatList();  // 刷新消息列表，确保红点正确显示

        // ===== 修复屏幕变黑：强制重新应用壁纸和主题 =====
        // 清除聊天窗口可能遗留的背景样式
        if (chatMessages) {
            chatMessages.style.backgroundImage = '';
            chatMessages.style.backgroundColor = '';
        }
        // 重新应用妈咪中心的壁纸和主题设置
        this.applyMammySettings();
        // 强制重绘，避免残留的 overlay 或半透明层
        const overlay = document.getElementById('overlay');
    if (overlay && overlay.classList.contains('active')) {
            overlay.classList.remove('active');
        }
        // 清除引用状态
        this.clearQuote();

        // 退出多选模式
        if (this.multiSelectMode) {
            this.exitMultiSelectMode();
        }
        // 关闭底部弹出菜单
        this.closeBottomSheet();
    }

    /**
     * 显示引用条
     */
    showQuoteBar() {
        if (!this.quoteMessage) return;

        let quoteBar = document.getElementById('quote-bar');
        if (!quoteBar) {
            const inputArea = document.querySelector('.chat-input-area');
            quoteBar = document.createElement('div');
            quoteBar.id = 'quote-bar';
            quoteBar.className = 'quote-bar';
            inputArea.insertBefore(quoteBar, inputArea.firstChild);
        }

        const senderName = this.quoteMessage.senderName;
        const preview = this.quoteMessage.preview;
        quoteBar.innerHTML = `
            <span class="quote-icon">💬</span>
            <span class="quote-text">回复 ${senderName}：${preview}</span>
            <button class="quote-close-btn" onclick="chatManager.clearQuote()">✕</button>
        `;
        quoteBar.style.display = 'flex';
    }

    /**
     * 清除引用
     */
    clearQuote() {
        this.quoteMessage = null;
        const quoteBar = document.getElementById('quote-bar');
        if (quoteBar) quoteBar.style.display = 'none';
    }

    switchToChat(chatId) {
        // 如果已经在该聊天，不做处理
        if (this.currentChat && this.currentChat.id === chatId) return;
        // 关闭当前聊天窗口（如果有）
        if (this.currentChat) this.closeChat();
        // 打开目标聊天
        this.openChat(chatId);
        // 关闭模态框
        const modal = document.querySelector('.modal.active');
        if (modal) modal.classList.remove('active');
    }

    /**
     * 拍一拍（支持拍自己和拍对方）
     * @param {string} chatId 聊天ID
     * @param {boolean} isSelf 是否拍自己（双击自己的头像）
     */
    pat(chatId, isSelf = false) {
        const chat = this.getChat(chatId);
        if (!chat) return;
        const mammyNick = this.mammySettings.nickname || '妈咪';
        let patText;
        if (isSelf) {
            // 拍自己：使用妈咪中心设置的拍一拍样式
            const style = this.mammySettings.patStyle || '拍了拍我的头';
            patText = `${mammyNick} ${style}`;
        } else {
            // 群聊中拍成员：需要获取被拍成员的个人设置
            let targetChat = this.getChat(chatId);
            if (targetChat && targetChat.isGroup) {
                // 如果chat是群聊，说明chatId是群聊ID，需要获取当前选中的成员
                // 这种情况通常不会发生，但为了安全处理
                targetChat = null;
            }
            const targetName = targetChat ? (targetChat.remarkName || targetChat.name) : '成员';
            let patStyle = targetChat?.patStyle;
            if (!patStyle) {
                patStyle = `拍了拍${targetName}`;
            }
            patText = `${mammyNick} ${patStyle}`;
            // 替换模板变量
            patText = patText.replace('${targetName}', targetName);
        }
        const patMessage = {
            type: 'pat',
            text: patText,
            timestamp: new Date().toISOString(),
            isMe: false  // 系统消息，不属于任何一方
        };
        chat.messages.push(patMessage);
        chat.lastMessage = patText;
        chat.lastTimestamp = patMessage.timestamp;
        chat.lastTime = this.getRelativeTime(new Date());
        // 未读计数：如果当前不在这个聊天窗口，增加未读
        if (!(this.currentChat && this.currentChat.id === chatId)) {
            chat.unreadCount = (chat.unreadCount || 0) + 1;
        } else {
            // 如果在当前聊天窗口，立即重新渲染并滚动到底部
            this.renderMessages(chat);
            this.scrollToBottom();
        }
        this.saveChats();
        this.renderChatList();
        this.updateMessageBadge();
        // 传递 isSelf 参数
        this.requestAIReplyForPat(chat, patText, isSelf);

        // 群聊场景下，触发群成员讨论拍一拍事件
        if (chat.isGroup && !isSelf) {
            const targetName = chat.remarkName || chat.name;
            this.triggerGroupReplies(chatId, `${mammyNick}刚才拍了拍${targetName}`);
        }
    }

    /**
     * 拍群聊中的某个成员（双击成员头像触发）
     * @param {string} memberId 被拍成员的ID
     * @param {string} operatorId 拍人者的ID（可选，用于AI触发的拍一拍）
     */
    patGroupMember(memberId, operatorId = null) {
        console.log('patGroupMember called', { memberId, operatorId });
        if (!this.currentChat || !this.currentChat.isGroup) return;

        // 使用 getMemberDisplayInfo 获取成员信息，该方法对 NPC 友好
        const memberInfo = this.getMemberDisplayInfo(memberId);
        const targetName = memberInfo.name;

        // 获取拍人者名称
        const mammyNick = this.mammySettings.nickname || '妈咪';
        let operatorName = mammyNick;
        if (operatorId && operatorId !== 'user_mummy') {
            const operatorInfo = this.getMemberDisplayInfo(operatorId);
            operatorName = operatorInfo.name;
        }

        // 构造拍一拍文案
        const patText = `${operatorName} 拍了拍 ${targetName}`;

        const patMessage = {
            type: 'pat',
            text: patText,
            timestamp: new Date().toISOString(),
            isMe: false,
            isSystem: true
        };

        this.currentChat.messages.push(patMessage);
        this.currentChat.lastMessage = patText;
        this.currentChat.lastTimestamp = patMessage.timestamp;
        this.currentChat.lastTime = this.getRelativeTime(new Date());

        if (!(this.currentChat && this.currentChat.id === this.currentChat.id)) {
            this.currentChat.unreadCount = (this.currentChat.unreadCount || 0) + 1;
        } else {
            this.renderMessages(this.currentChat);
            this.scrollToBottom();
        }
        this.saveChats();
        this.renderChatList();
        this.updateMessageBadge();

        // 触发群成员讨论拍一拍事件
        this.triggerGroupEventDiscussion(this.currentChat.id, `${operatorName}拍了拍${targetName}`);
    }

    /**
     * 在群聊中自拍（AI 触发）
     * @param {string} operatorId 拍人者的ID（即自己）
     */
    patSelfInGroup(operatorId) {
        if (!this.currentChat || !this.currentChat.isGroup) return;

        // 获取拍人者名称
        const mammyNick = this.mammySettings.nickname || '妈咪';
        let operatorName = mammyNick;
        if (operatorId && operatorId !== 'user_mummy') {
            const operatorInfo = this.getMemberDisplayInfo(operatorId);
            operatorName = operatorInfo.name;
        }

        // 自拍文案
        const patText = `${operatorName} 拍了拍自己`;

        const patMessage = {
            type: 'pat',
            text: patText,
            timestamp: new Date().toISOString(),
            isMe: false,
            isSystem: true
        };

        this.currentChat.messages.push(patMessage);
        this.currentChat.lastMessage = patText;
        this.currentChat.lastTimestamp = patMessage.timestamp;
        this.currentChat.lastTime = this.getRelativeTime(new Date());

        if (!(this.currentChat && this.currentChat.id === this.currentChat.id)) {
            this.currentChat.unreadCount = (this.currentChat.unreadCount || 0) + 1;
        } else {
            this.renderMessages(this.currentChat);
            this.scrollToBottom();
        }
        this.saveChats();
        this.renderChatList();
        this.updateMessageBadge();

        // 触发群成员讨论拍一拍事件
        this.triggerGroupEventDiscussion(this.currentChat.id, `${operatorName}拍了拍自己`);
    }

    /**
     * 在群聊中拍妈咪（AI 触发）
     * @param {string} operatorId 拍人者的ID
     */
    patMammyInGroup(operatorId) {
        if (!this.currentChat || !this.currentChat.isGroup) return;

        // 获取拍人者名称
        const mammyNick = this.mammySettings.nickname || '妈咪';
        let operatorName = mammyNick;
        if (operatorId && operatorId !== 'user_mummy') {
            const operatorInfo = this.getMemberDisplayInfo(operatorId);
            if (operatorInfo && operatorInfo.name) {
                operatorName = operatorInfo.name;
            }
        }

        // 拍妈咪的文案
        const patText = `${operatorName} 拍了拍 ${mammyNick}`;

        const patMessage = {
            type: 'pat',
            text: patText,
            timestamp: new Date().toISOString(),
            isMe: false,
            isSystem: true
        };

        this.currentChat.messages.push(patMessage);
        this.currentChat.lastMessage = patText;
        this.currentChat.lastTimestamp = patMessage.timestamp;
        this.currentChat.lastTime = this.getRelativeTime(new Date());

        if (!(this.currentChat && this.currentChat.id === this.currentChat.id)) {
            this.currentChat.unreadCount = (this.currentChat.unreadCount || 0) + 1;
        } else {
            this.renderMessages(this.currentChat);
            this.scrollToBottom();
        }
        this.saveChats();
        this.renderChatList();
        this.updateMessageBadge();

        // 触发群成员讨论拍一拍事件
        this.triggerGroupEventDiscussion(this.currentChat.id, `${operatorName}拍了拍${mammyNick}`);
    }

    /**
     * 在单聊中拍妈咪（AI 触发）
     * @param {string} chatId 单聊ID
     * @param {string} operatorId 拍人者的ID
     */
    patMammyInChat(chatId, operatorId) {
        const chat = this.getChat(chatId);
        if (!chat || chat.isGroup) return;

        // 获取拍人者名称
        const mammyNick = this.mammySettings.nickname || '妈咪';
        let operatorName = mammyNick;
        if (operatorId && operatorId !== 'user_mummy') {
            const operatorInfo = this.getMemberDisplayInfo(operatorId);
            if (operatorInfo && operatorInfo.name) {
                operatorName = operatorInfo.name;
            }
        }

        // 拍妈咪的文案
        const patText = `${operatorName} 拍了拍 ${mammyNick}`;

        const patMessage = {
            type: 'pat',
            text: patText,
            timestamp: new Date().toISOString(),
            isMe: false,
            isSystem: true
        };

        chat.messages.push(patMessage);
        chat.lastMessage = patText;
        chat.lastTimestamp = patMessage.timestamp;
        chat.lastTime = this.getRelativeTime(new Date());

        if (!(this.currentChat && this.currentChat.id === chatId)) {
            chat.unreadCount = (chat.unreadCount || 0) + 1;
        } else {
            this.renderMessages(chat);
            this.scrollToBottom();
        }
        this.saveChats();
        this.renderChatList();
        this.updateMessageBadge();
    }

    /**
     * 在单聊中自拍（AI 触发）
     * @param {string} chatId 单聊ID
     * @param {string} operatorId 拍人者的ID
     */
    patSelfInChat(chatId, operatorId) {
        const chat = this.getChat(chatId);
        if (!chat || chat.isGroup) return;

        // 获取拍人者名称
        const mammyNick = this.mammySettings.nickname || '妈咪';
        let operatorName = mammyNick;
        if (operatorId && operatorId !== 'user_mummy') {
            const operatorInfo = this.getMemberDisplayInfo(operatorId);
            if (operatorInfo && operatorInfo.name) {
                operatorName = operatorInfo.name;
            }
        }

        // 自拍文案
        const patText = `${operatorName} 拍了拍自己`;

        const patMessage = {
            type: 'pat',
            text: patText,
            timestamp: new Date().toISOString(),
            isMe: false,
            isSystem: true
        };

        chat.messages.push(patMessage);
        chat.lastMessage = patText;
        chat.lastTimestamp = patMessage.timestamp;
        chat.lastTime = this.getRelativeTime(new Date());

        if (!(this.currentChat && this.currentChat.id === chatId)) {
            chat.unreadCount = (chat.unreadCount || 0) + 1;
        } else {
            this.renderMessages(chat);
            this.scrollToBottom();
        }
        this.saveChats();
        this.renderChatList();
        this.updateMessageBadge();
    }

    /**
     * 在单聊中拍妈咪（AI 触发）
     * @param {string} chatId 单聊ID
     * @param {string} operatorId 拍人者的ID
     */
    patMammyInChat(chatId, operatorId) {
        const chat = this.getChat(chatId);
        if (!chat || chat.isGroup) return;

        // 获取拍人者名称
        const mammyNick = this.mammySettings.nickname || '妈咪';
        let operatorName = mammyNick;
        if (operatorId && operatorId !== 'user_mummy') {
            const operatorInfo = this.getMemberDisplayInfo(operatorId);
            if (operatorInfo && operatorInfo.name) {
                operatorName = operatorInfo.name;
            }
        }

        // 拍妈咪的文案
        const patText = `${operatorName} 拍了拍 ${mammyNick}`;

        const patMessage = {
            type: 'pat',
            text: patText,
            timestamp: new Date().toISOString(),
            isMe: false,
            isSystem: true
        };

        chat.messages.push(patMessage);
        chat.lastMessage = patText;
        chat.lastTimestamp = patMessage.timestamp;
        chat.lastTime = this.getRelativeTime(new Date());

        this.saveChats();

        if (this.currentChat && this.currentChat.id === chatId) {
            this.renderMessages(chat);
            this.scrollToBottom();
        } else {
            chat.unreadCount = (chat.unreadCount || 0) + 1;
            this.renderChatList();
            this.updateMessageBadge();
        }
    }

    /**
     * 在单聊中自拍（AI 触发）
     * @param {string} chatId 单聊ID
     * @param {string} operatorId 拍人者的ID
     */
    patSelfInChat(chatId, operatorId) {
        const chat = this.getChat(chatId);
        if (!chat || chat.isGroup) return;

        // 获取拍人者名称
        const mammyNick = this.mammySettings.nickname || '妈咪';
        let operatorName = mammyNick;
        if (operatorId && operatorId !== 'user_mummy') {
            const operatorInfo = this.getMemberDisplayInfo(operatorId);
            if (operatorInfo && operatorInfo.name) {
                operatorName = operatorInfo.name;
            }
        }

        // 自拍文案
        const patText = `${operatorName} 拍了拍自己`;

        const patMessage = {
            type: 'pat',
            text: patText,
            timestamp: new Date().toISOString(),
            isMe: false,
            isSystem: true
        };

        chat.messages.push(patMessage);
        chat.lastMessage = patText;
        chat.lastTimestamp = patMessage.timestamp;
        chat.lastTime = this.getRelativeTime(new Date());

        this.saveChats();

        if (this.currentChat && this.currentChat.id === chatId) {
            this.renderMessages(chat);
            this.scrollToBottom();
        } else {
            chat.unreadCount = (chat.unreadCount || 0) + 1;
            this.renderChatList();
            this.updateMessageBadge();
        }
    }

    /**
     * 检查群聊是否需要解散（人数不足）
     * @param {string} chatId 群聊ID
     */
    checkAndDisbandGroupIfNeeded(chatId) {
        const chat = this.getChat(chatId);
        if (!chat || !chat.isGroup) return;

        // 总人数 = 群成员数量 + 1 (用户自己)
        const totalMembers = (chat.members?.length || 0) + 1;
        if (totalMembers <= 2) {
            // 执行解散
            this.disbandGroup(chatId);
        }
    }

    /**
     * 解散群聊
     * @param {string} chatId 群聊ID
     */
    disbandGroup(chatId) {
        const chat = this.getChat(chatId);
        if (!chat || !chat.isGroup) return;

        // 从 chats 数组中删除该群聊
        this.chats = this.chats.filter(c => c.id !== chatId);

        // 从 contacts 数组中删除该群聊联系人
        this.contacts = this.contacts.filter(c => c.id !== chatId);

        // 如果当前打开的聊天窗口正是该群聊，则关闭
        if (this.currentChat && this.currentChat.id === chatId) {
            this.closeChat();
        }

        // 保存数据
        this.saveChats();

        // 刷新联系人列表和聊天列表
        this.renderContacts();
        this.renderChatList();

        // 显示系统通知
        this.showNotification('群聊人数不足，已自动解散');
    }

    /**
     * 拍整个群聊（双击群名称触发）
     * @param {Object} chat 群聊对象
     */
    patWholeGroup(chat) {
        if (!chat || !chat.isGroup) return;
        const mammyNick = this.mammySettings.nickname || '妈咪';
        const patStyle = chat.groupPatStyle || '拍了拍群';
        const patText = `${mammyNick} ${patStyle}`;

        const patMessage = {
            type: 'pat',
            text: patText,
            content: patText,   // 兼容字段
            timestamp: new Date().toISOString(),
            isMe: false,
            isSystem: true   // 使用系统消息样式
        };
        chat.messages.push(patMessage);
        chat.lastMessage = patText;
        chat.lastTimestamp = patMessage.timestamp;
        chat.lastTime = this.getRelativeTime(new Date());

        if (this.currentChat && this.currentChat.id === chat.id) {
            this.renderMessages(chat);
            this.scrollToBottom();
        } else {
            chat.unreadCount = (chat.unreadCount || 0) + 1;
        }
        this.saveChats();
        this.renderChatList();
        this.updateMessageBadge();

        // 触发群成员对拍一拍事件的讨论
        this.triggerGroupEventDiscussion(chat.id, `妈咪拍了拍群（${patStyle}）`);
    }

    /**
     * 渲染禁言管理列表
     */
    renderGroupMuteList() {
        const container = document.getElementById('group-mute-list');
        if (!container || !this.currentChat || !this.currentChat.isGroup) return;

        const members = this.currentChat.members || [];
        const mutedMembers = this.currentChat.mutedMembers || {};

        container.innerHTML = members.map(memberId => {
            const memberInfo = this.getMemberDisplayInfo(memberId);
            const name = memberInfo.name;
            const isMuted = !!mutedMembers[memberId];
            const muteInfo = mutedMembers[memberId];
            let statusText = '';
            let buttonText = '禁言';
            let buttonClass = 'mute-btn';
            let buttonAction = 'mute';

            if (muteInfo === 'forever') {
                statusText = '永久禁言';
                buttonText = '解除';
                buttonClass = 'unmute-btn';
                buttonAction = 'unmute';
            } else if (muteInfo && muteInfo > Date.now()) {
                const remain = Math.ceil((muteInfo - Date.now()) / 60000);
                statusText = `禁言 ${remain} 分钟`;
                buttonText = '解除';
                buttonClass = 'unmute-btn';
                buttonAction = 'unmute';
            } else if (muteInfo) {
                // 已过期，清除
                delete mutedMembers[memberId];
            }

            return `
                <div class="mute-member-item" style="display: flex; flex-direction: column; align-items: center; padding: 8px; border: 1px solid var(--border); border-radius: 8px;">
                    <span style="font-weight: 500;">${name}</span>
                    ${statusText ? `<span style="font-size: 12px; color: #e53e3e;">${statusText}</span>` : ''}
                    <button class="${buttonClass}" data-member-id="${memberId}" data-action="${buttonAction}" style="margin-top: 6px; padding: 4px 8px; font-size: 12px; background: ${buttonClass === 'unmute-btn' ? '#4caf50' : '#e53e3e'}; color: white; border: none; border-radius: 4px; cursor: pointer;">${buttonText}</button>
                </div>
            `;
        }).join('');

        // 绑定禁言/解除按钮事件
        container.querySelectorAll('.mute-btn, .unmute-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const memberId = btn.dataset.memberId;
                const action = btn.dataset.action;
                if (action === 'unmute') {
                    this.unmuteGroupMember(memberId);
                } else {
                    this.showMuteDurationSelector(memberId);
                }
            });
        });
    }

    /**
     * 渲染管理员列表
     */
    renderGroupAdminList() {
        const container = document.getElementById('group-admin-list');
        if (!container || !this.currentChat || !this.currentChat.isGroup) return;

        const admins = this.currentChat.admins || [];
        if (admins.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 12px;">暂无管理员</p>';
        } else {
            container.innerHTML = admins.map(adminId => {
                const memberInfo = this.getMemberDisplayInfo(adminId);
                const name = memberInfo.name;
                const avatar = memberInfo.avatar;
                let avatarHtml = (avatar && typeof avatar === 'string' && avatar.startsWith('http'))
                    ? `<img src="${avatar}" style="width: 30px; height: 30px; border-radius: 50%; object-fit: cover;">`
                    : `<span>${avatar}</span>`;

                return `
                    <div class="admin-item" style="display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--card-bg);">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <div style="width: 30px; height: 30px; border-radius: 50%; background: var(--nav-active-bg); display: flex; align-items: center; justify-content: center;">
                                ${avatarHtml}
                            </div>
                            <span style="font-size: 14px;">${name}</span>
                        </div>
                        <button class="remove-admin-btn" data-admin-id="${adminId}" style="background: none; border: none; color: #e53e3e; font-size: 18px; cursor: pointer;">✕</button>
                    </div>
                `;
            }).join('');
        }

        // 绑定移除按钮事件（确保每次渲染后重新绑定）
        container.querySelectorAll('.remove-admin-btn').forEach(btn => {
            if (!btn.hasAttribute('data-listener-bound')) {
                btn.setAttribute('data-listener-bound', 'true');
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const adminId = btn.dataset.adminId;
                    this.removeGroupAdmin(adminId);
                });
            }
        });

        // 绑定添加按钮（延迟确保 DOM 就绪）
        setTimeout(() => {
            const addBtn = document.getElementById('add-admin-btn');
            if (addBtn) {
                addBtn.removeEventListener('click', this._addAdminHandler);
                this._addAdminHandler = () => this.showAddAdminSelector();
                addBtn.addEventListener('click', this._addAdminHandler);
            }
        }, 0);
    }

    /**
     * 显示添加管理员选择器
     */
    showAddAdminSelector() {
        const chat = this.currentChat;
        if (!chat || !chat.isGroup) return;

        const members = chat.members || [];
        const admins = chat.admins || [];
        // 过滤出可添加为管理员的成员（非妈咪，且不在现有管理员列表中）
        const candidates = members.filter(id => id !== 'user_mummy' && !admins.includes(id));

        if (candidates.length === 0) {
            this.showNotification('没有可添加的成员');
            return;
        }

        // 创建浮动菜单
        const existing = document.querySelector('.admin-selector-menu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.className = 'dynamic-popup-menu admin-selector-menu';
        menu.style.maxHeight = '250px';
        menu.style.overflowY = 'auto';
        menu.style.minWidth = '160px';

        candidates.forEach(memberId => {
            const info = this.getMemberDisplayInfo(memberId);
            const name = info.name;
            const item = document.createElement('div');
            item.className = 'popup-menu-item';
            item.textContent = name;
            item.onclick = (e) => {
                e.stopPropagation();
                this.addGroupAdmin(memberId);
                menu.remove();
            };
            menu.appendChild(item);
        });

        // 定位在添加按钮下方
        const btn = document.getElementById('add-admin-btn');
        const rect = btn.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.left = rect.left + 'px';
        menu.style.top = (rect.bottom + 5) + 'px';
        document.body.appendChild(menu);

        const closeHandler = (e) => {
            if (!menu.contains(e.target) && e.target !== btn) {
                menu.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 10);
    }

    /**
     * 添加管理员
     * @param {string} memberId 成员ID
     */
    addGroupAdmin(memberId) {
        const chat = this.currentChat;
        if (!chat || !chat.isGroup) return;
        if (!chat.admins) chat.admins = [];
        if (chat.admins.includes(memberId)) return;

        chat.admins.push(memberId);

        const memberInfo = this.getMemberDisplayInfo(memberId);
        const memberName = memberInfo.name;
        const mammyNick = this.mammySettings.nickname || '妈咪';

        const sysMsg = {
            text: `${memberName} 被 ${mammyNick} 设置为管理员`,
            content: `${memberName} 被 ${mammyNick} 设置为管理员`,
            timestamp: new Date().toISOString(),
            isSystem: true
        };
        chat.messages.push(sysMsg);
        chat.lastMessage = sysMsg.text;
        chat.lastTimestamp = sysMsg.timestamp;
        chat.lastTime = this.getRelativeTime(new Date());

        this.saveChats();
        this.renderGroupAdminList(); // 刷新管理员列表

        if (this.currentChat && this.currentChat.id === chat.id) {
            this.renderMessages(chat);
            this.scrollToBottom();
        }
        this.showNotification(`已设置 ${memberName} 为管理员`);

        // 触发群事件讨论：成员被设置为管理员
        this.triggerGroupEventDiscussion(chat.id, `${memberName} 被设置为管理员`);
    }

    /**
     * 移除管理员
     * @param {string} adminId 管理员ID
     */
    removeGroupAdmin(adminId) {
        const chat = this.currentChat;
        if (!chat || !chat.isGroup) return;
        if (!chat.admins) return;

        chat.admins = chat.admins.filter(id => id !== adminId);

        const memberInfo = this.getMemberDisplayInfo(adminId);
        const memberName = memberInfo.name;
        const mammyNick = this.mammySettings.nickname || '妈咪';

        const sysMsg = {
            text: `${memberName} 被 ${mammyNick} 取消管理员`,
            content: `${memberName} 被 ${mammyNick} 取消管理员`,
            timestamp: new Date().toISOString(),
            isSystem: true
        };
        chat.messages.push(sysMsg);
        chat.lastMessage = sysMsg.text;
        chat.lastTimestamp = sysMsg.timestamp;
        chat.lastTime = this.getRelativeTime(new Date());

        this.saveChats();
        this.renderGroupAdminList();

        if (this.currentChat && this.currentChat.id === chat.id) {
            this.renderMessages(chat);
            this.scrollToBottom();
        }
        this.showNotification(`已取消 ${memberName} 的管理员`);

        // 触发群事件讨论：成员被取消管理员
        this.triggerGroupEventDiscussion(chat.id, `${memberName} 被取消了管理员`);
    }

    /**
     * 显示禁言时长选择菜单
     * @param {string} memberId 成员ID
     */
    showMuteDurationSelector(memberId) {
        const existing = document.querySelector('.mute-duration-menu');
        if (existing) existing.remove();

        const durations = [
            { label: '5分钟', value: 5 * 60 * 1000 },
            { label: '30分钟', value: 30 * 60 * 1000 },
            { label: '1小时', value: 60 * 60 * 1000 },
            { label: '12小时', value: 12 * 60 * 60 * 1000 },
            { label: '1天', value: 24 * 60 * 60 * 1000 },
            { label: '永久', value: 'forever' }
        ];

        const menu = document.createElement('div');
        menu.className = 'dynamic-popup-menu mute-duration-menu';
        durations.forEach(d => {
            const item = document.createElement('div');
            item.className = 'popup-menu-item';
            item.textContent = d.label;
            item.onclick = () => {
                this.muteGroupMember(memberId, d.value);
                menu.remove();
            };
            menu.appendChild(item);
        });

        // 定位在点击按钮附近
        const btn = event.target;
        const rect = btn.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.left = rect.left + 'px';
        menu.style.top = (rect.bottom + 5) + 'px';
        document.body.appendChild(menu);

        const closeHandler = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 10);
    }

    /**
     * 禁言群成员
     * @param {string} memberId 成员ID
     * @param {number|string} duration 禁言时长（毫秒）或 'forever'
     */
    muteGroupMember(memberId, duration, operatorId = null) {
        const chat = this.currentChat;
        if (!chat || !chat.isGroup) return;

        // 权限检查（妈咪始终可禁言）
        if (memberId === 'user_mummy') {
            this.showNotification('不能禁言自己');
            return;
        }

        if (!chat.mutedMembers) chat.mutedMembers = {};

        const until = duration === 'forever' ? 'forever' : Date.now() + duration;
        chat.mutedMembers[memberId] = until;

        // 获取成员名称（使用 getMemberDisplayInfo 支持 NPC）
        const memberInfo = this.getMemberDisplayInfo(memberId);
        const memberName = memberInfo.name;
        // 获取操作者的昵称，如果未传入则默认为妈咪
        let operatorName = this.mammySettings.nickname || '妈咪';
        if (operatorId) {
            const operatorInfo = this.getMemberDisplayInfo(operatorId);
            operatorName = operatorInfo.name;
        }

        // 生成系统消息
        let durationText = '';
        if (duration === 'forever') durationText = '永久';
        else durationText = `${duration / 60000} 分钟`;
        const sysMsg = {
            text: `${memberName} 被 ${operatorName} 禁言 ${durationText}`,
            timestamp: new Date().toISOString(),
            isSystem: true
        };
        chat.messages.push(sysMsg);
        chat.lastMessage = sysMsg.text;
        chat.lastTimestamp = sysMsg.timestamp;
        chat.lastTime = this.getRelativeTime(new Date());

        this.saveChats();
        this.renderGroupMuteList(); // 刷新禁言列表

        if (this.currentChat && this.currentChat.id === chat.id) {
            this.renderMessages(chat);
            this.scrollToBottom();
            // 如果被禁言的是当前聊天窗口的成员（虽然当前是群聊，但如果是自己发言会受影响）
            this.checkMuteStatusForInput();
        } else {
            chat.unreadCount = (chat.unreadCount || 0) + 1;
            this.renderChatList();
            this.updateMessageBadge();
        }

        this.showNotification(`已禁言 ${memberName}`);

        // 触发群事件讨论：成员被禁言
        this.triggerGroupEventDiscussion(chat.id, `${memberName} 被禁言了${durationText}`);

        // 设置禁言到期定时器
        if (duration !== 'forever') {
            // 清除旧定时器
            if (this.muteExpireTimers.has(memberId)) {
                clearTimeout(this.muteExpireTimers.get(memberId));
                this.muteExpireTimers.delete(memberId);
            }
            // 设置新定时器
            const timer = setTimeout(() => {
                this.triggerMemberReplyAfterUnmute(chat.id, memberId);
                this.muteExpireTimers.delete(memberId);
            }, duration);
            this.muteExpireTimers.set(memberId, timer);
        }
    }

    /**
     * 更新群公告（管理员操作）
     * @param {string} chatId 群聊ID
     * @param {string} notice 新公告内容
     * @param {string} operatorId 操作者ID
     */
    updateGroupNotice(chatId, notice, operatorId = null) {
        const chat = this.getChat(chatId);
        if (!chat || !chat.isGroup) return;

        const oldNotice = chat.groupNotice || '';
        chat.groupNotice = notice;

        // 获取操作者名称
        let operatorName = this.mammySettings.nickname || '妈咪';
        if (operatorId) {
            const operatorInfo = this.getMemberDisplayInfo(operatorId);
            operatorName = operatorInfo.name;
        }

        // 发送系统消息
        const sysMsg = {
            text: `${operatorName} 修改群公告为：${notice}`,
            timestamp: new Date().toISOString(),
            isSystem: true
        };
        chat.messages.push(sysMsg);
        chat.lastMessage = sysMsg.text;
        chat.lastTimestamp = sysMsg.timestamp;
        chat.lastTime = this.getRelativeTime(new Date());

        this.saveChats();

        // 更新UI
        if (this.currentChat && this.currentChat.id === chatId) {
            this.renderMessages(chat);
            this.scrollToBottom();
            this.updateGroupNoticeBar(chat);
        } else {
            chat.unreadCount = (chat.unreadCount || 0) + 1;
            this.renderChatList();
            this.updateMessageBadge();
        }

        this.showNotification('群公告已更新');

        // 触发群事件讨论
        this.triggerGroupEventDiscussion(chatId, `${operatorName} 修改了群公告`);
    }

    /**
     * 修改群名称（管理员操作）
     * @param {string} chatId 群聊ID
     * @param {string} newName 新群名称
     * @param {string} operatorId 操作者ID
     */
    renameGroup(chatId, newName, operatorId = null) {
        const chat = this.getChat(chatId);
        if (!chat || !chat.isGroup) return;

        const oldName = chat.name;
        chat.name = newName;

        // 获取操人物名称
        let operatorName = this.mammySettings.nickname || '妈咪';
        if (operatorId) {
            const operatorInfo = this.getMemberDisplayInfo(operatorId);
            operatorName = operatorInfo.name;
        }

        // 同步更新 contacts 中的群名称
        const contactIndex = this.contacts.findIndex(c => c.id === chatId);
        if (contactIndex !== -1) {
            this.contacts[contactIndex].name = newName;
        }

        // 发送系统消息
        const sysMsg = {
            text: `${operatorName} 将群名称修改为：${newName}`,
            timestamp: new Date().toISOString(),
            isSystem: true
        };
        chat.messages.push(sysMsg);
        chat.lastMessage = sysMsg.text;
        chat.lastTimestamp = sysMsg.timestamp;
        chat.lastTime = this.getRelativeTime(new Date());

        this.saveChats();

        // 更新UI
        if (this.currentChat && this.currentChat.id === chatId) {
            this.renderMessages(chat);
            this.scrollToBottom();
            // 更新聊天标题
            const chatTitleEl = document.getElementById('chat-title');
            if (chatTitleEl) chatTitleEl.textContent = newName;
        }

        // 更新聊天列表
        this.renderChatList();
        this.updateMessageBadge();

        this.showNotification(`群名称已修改为：${newName}`);

        // 触发群事件讨论
        this.triggerGroupEventDiscussion(chatId, `${operatorName} 将群名称从 "${oldName}" 修改为 "${newName}"`);
    }

    /**
     * 解除禁言
     * @param {string} memberId 成员ID
     */
    unmuteGroupMember(memberId) {
        const chat = this.currentChat;
        if (!chat || !chat.isGroup) return;
        if (!chat.mutedMembers) return;

        delete chat.mutedMembers[memberId];

        // 清除禁言到期定时器
        if (this.muteExpireTimers.has(memberId)) {
            clearTimeout(this.muteExpireTimers.get(memberId));
            this.muteExpireTimers.delete(memberId);
        }

        // 获取成员名称（使用 getMemberDisplayInfo 支持 NPC）
        const memberInfo = this.getMemberDisplayInfo(memberId);
        const memberName = memberInfo.name;
        const mammyNick = this.mammySettings.nickname || '妈咪';

        const sysMsg = {
            text: `${memberName} 被 ${mammyNick} 解除禁言`,
            timestamp: new Date().toISOString(),
            isSystem: true
        };
        chat.messages.push(sysMsg);
        chat.lastMessage = sysMsg.text;
        chat.lastTimestamp = sysMsg.timestamp;
        chat.lastTime = this.getRelativeTime(new Date());

        this.saveChats();
        this.renderGroupMuteList();
        if (this.currentChat && this.currentChat.id === chat.id) {
            this.renderMessages(chat);
            this.scrollToBottom();
            this.checkMuteStatusForInput();
        }
        this.showNotification(`已解除对 ${memberName} 的禁言`);

        // 触发群事件讨论：成员被解除禁言
        this.triggerGroupEventDiscussion(chat.id, `${memberName} 被解除禁言了`);
    }

    /**
     * 检查输入框禁言状态
     */
    checkMuteStatusForInput() {
        if (!this.currentChat || !this.currentChat.isGroup) return;
        const mutedMembers = this.currentChat.mutedMembers || {};
        const myMute = mutedMembers['user_mummy'];
        const input = document.getElementById('msg-input');
        const sendBtn = document.getElementById('send-btn');
        if (myMute && (myMute === 'forever' || myMute > Date.now())) {
            input.disabled = true;
            sendBtn.disabled = true;
            input.placeholder = '你已被禁言';
        } else {
            input.disabled = false;
            sendBtn.disabled = false;
            input.placeholder = '输入消息...';
        }
    }

    /**
     * 清理已过期的禁言记录
     * @param {Object} chat 群聊对象
     */
    cleanExpiredMutes(chat) {
        if (!chat || !chat.isGroup || !chat.mutedMembers) return;
        const now = Date.now();
        Object.keys(chat.mutedMembers).forEach(memberId => {
            const until = chat.mutedMembers[memberId];
            if (until !== 'forever' && until < now) {
                delete chat.mutedMembers[memberId];
            }
        });
    }

    /**
     * 拍一拍后请求 AI 回复
     * @param {Object} chat 聊天对象
     * @param {string} patText 拍一拍文本
     */
    async requestAIReplyForPat(chat, patText, isSelf = false) {
        // 如果未配置 API，使用模拟回复
        const settings = this.mammySettings;
        const mammyNick = this.mammySettings.nickname || '妈咪';
        let userMessage;
        if (isSelf) {
            userMessage = `${mammyNick} 拍了拍她自己（${patText}）。这不是在拍你，是她自己在玩。请根据你的角色性格，对妈咪自拍这个行为回复一句话（可以觉得好笑、奇怪、自恋、调侃等）。`;
        } else {
            userMessage = `${mammyNick} 拍了拍你：${patText}。请根据你的角色性格回复一句话。`;
        }
        if (!settings || !settings.apiUrl || !settings.apiKey || !settings.modelName) {
            const mockReplies = ['嘿嘿，别拍啦～', '哎呀，干嘛拍我～', '哼，再拍就不理你了～', '拍我干嘛呀～'];
            const reply = mockReplies[Math.floor(Math.random() * mockReplies.length)];
            this.addMessageWithEmotion(chat.id, reply);
            if (this.currentChat && this.currentChat.id === chat.id) {
                this.renderMessages(chat);
                this.scrollToBottom();
            }
            return;
        }
        try {
            const reply = await this.callAI(chat.id, userMessage);
            if (reply) {
                this.addMessageWithEmotion(chat.id, reply);
                if (this.currentChat && this.currentChat.id === chat.id) {
                    this.renderMessages(chat);
                    this.scrollToBottom();
                }
            }
        } catch (error) {
            console.error('拍一拍AI回复失败', error);
            // 失败时使用模拟回复
            const mockReplies = ['嘿嘿，别拍啦～', '哎呀，干嘛拍我～', '哼，再拍就不理你了～', '拍我干嘛呀～'];
            const reply = mockReplies[Math.floor(Math.random() * mockReplies.length)];
            this.addMessage(chat.id, reply, false);
            if (this.currentChat && this.currentChat.id === chat.id) {
                this.renderMessages(chat);
                this.scrollToBottom();
            }
        }
    }

    scrollToBottom() {
        const chatMessages = document.getElementById('chat-messages');
        if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    /**
     * 设置聊天消息区域的滚动事件（用于向上滚动加载历史消息）
     */
    setupChatScroll(chat) {
        const chatMessages = document.getElementById('chat-messages');
        if (!chatMessages || !chat) return;

        // 清除之前的事件监听
        if (chatMessages._scrollHandler) {
            chatMessages.removeEventListener('scroll', chatMessages._scrollHandler);
        }

        // 初始化分页状态
        if (!this.historyPage) this.historyPage = {};
        if (!this.historyHasMore) this.historyHasMore = {};
        if (!this.historyPageSize) this.historyPageSize = 20;

        const totalMessages = chat.messages.length;
        this.historyPage[chat.id] = 1;
        this.historyHasMore[chat.id] = totalMessages > this.historyPageSize;

        // 确保加载指示器存在
        let loadingEl = document.getElementById('history-loading');
        if (!loadingEl) {
            loadingEl = document.createElement('div');
            loadingEl.id = 'history-loading';
            loadingEl.className = 'history-loading';
            loadingEl.style.cssText = 'display: none; text-align: center; padding: 10px;';
            loadingEl.innerHTML = '<div class="spinner"></div> 加载更多历史消息...';
            chatMessages.insertBefore(loadingEl, chatMessages.firstChild);
        }

        const handleScroll = () => {
            // 如果正在加载或没有更多消息，直接返回
            if (chatMessages._loading || !this.historyHasMore[chat.id]) return;

            const scrollTop = chatMessages.scrollTop;
            // 当滚动到顶部附近时（例如距离顶部50px），加载更多历史消息
            if (scrollTop <= 50) {
                chatMessages._loading = true;
                // 显示加载指示器
                loadingEl.style.display = 'block';
                this.loadMoreHistoryMessages(chat);
            }
        };

        // 使用节流（throttle）
        let ticking = false;
        const throttledHandleScroll = () => {
            if (!ticking) {
                window.requestAnimationFrame(() => {
                    handleScroll();
                    ticking = false;
                });
                ticking = true;
            }
        };

        chatMessages.addEventListener('scroll', throttledHandleScroll);
        chatMessages._scrollHandler = throttledHandleScroll;
    }

    /**
     * 加载更多历史消息（增量渲染）
     */
    loadMoreHistoryMessages(chat) {
        if (!this.historyPage || !this.historyPageSize) return;

        const page = this.historyPage[chat.id] || 1;
        const totalMessages = chat.messages.length;
        const startIndex = Math.max(0, totalMessages - (page + 1) * this.historyPageSize);
        const endIndex = totalMessages - page * this.historyPageSize;

        // 如果没有更多消息
        if (startIndex <= 0 && endIndex <= 0) {
            this.historyHasMore[chat.id] = false;
            const loadingEl = document.getElementById('history-loading');
            if (loadingEl) loadingEl.style.display = 'none';
            return;
        }

        // 获取要加载的消息段
        const messagesToLoad = chat.messages.slice(startIndex, endIndex);
        if (messagesToLoad.length === 0) {
            this.historyHasMore[chat.id] = false;
            const loadingEl = document.getElementById('history-loading');
            if (loadingEl) loadingEl.style.display = 'none';
            return;
        }

        // 生成HTML并增量渲染
        const chatMessagesEl = document.getElementById('chat-messages');
        if (chatMessagesEl) {
            // 保存插入前第一条消息的位置
            const firstMsgBefore = chatMessagesEl.firstElementChild;
            const firstMsgTopBefore = firstMsgBefore ? firstMsgBefore.offsetTop : 0;

            // 复用 renderMessages 方法渲染历史消息
            this.renderMessages(chat, messagesToLoad);

            // 调整滚动位置
            setTimeout(() => {
                const loadingEl = document.getElementById('history-loading');
                // 隐藏加载指示器
                if (loadingEl) loadingEl.style.display = 'none';

                // 计算滚动位置调整
                const firstMsgAfter = chatMessagesEl.firstElementChild;
                if (firstMsgAfter && firstMsgBefore) {
                    const scrollDiff = firstMsgAfter.offsetTop - firstMsgTopBefore;
                    chatMessagesEl.scrollTop += scrollDiff;
                }
            }, 10);
        }

        // 更新分页状态
        this.historyPage[chat.id] = page + 1;
        this.historyHasMore[chat.id] = startIndex > 0;

        // 重置加载状态
        chatMessagesEl._loading = false;
    }

        
    // ========== 图片动态列表方法 ==========

    /** 添加图片URL到列表 */
    addImageToList() {
        const input = document.getElementById('post-image-input');
        const url = input.value.trim();
        if (!url) return;

        const list = document.getElementById('image-url-list');
        const existing = list.querySelectorAll('.image-url-item');
        if (existing.length >= 10) {
            this.showNotification('最多添加10张图片');
            return;
        }

        // 创建列表项
        const item = document.createElement('div');
        item.className = 'image-url-item';
        item.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--bg-page); border-radius: 8px;';
        item.innerHTML = `
            <span style="flex: 1; font-size: 13px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${url}</span>
            <button type="button" style="background: none; border: none; color: #e53e3e; cursor: pointer; font-size: 16px;" onclick="this.parentElement.remove(); chatManager.updateImagePreview();">✕</button>
        `;
        list.appendChild(item);

        input.value = '';
        this.updateImagePreview();
    }

    /** 更新图片预览 */
    updateImagePreview() {
        const items = document.querySelectorAll('#image-url-list .image-url-item span');
        const preview = document.getElementById('image-preview');
        preview.innerHTML = '';
        items.forEach(item => {
            const url = item.textContent.trim();
            if (url) {
                preview.innerHTML += `<img src="${url}" style="max-width:100px; max-height:100px; border-radius: 8px; margin: 4px;" onerror="this.parentElement.innerHTML='<span style=color:red>图片加载失败</span>';">`;
            }
        });
    }

    /** 获取当前图片列表 */
    getImageUrls() {
        const items = document.querySelectorAll('#image-url-list .image-url-item span');
        const urls = [];
        items.forEach(item => {
            const url = item.textContent.trim();
            if (url) urls.push(url);
        });
        return urls;
    }

    // ========== 标签动态列表方法 ==========

    /** 添加标签到列表 */
    addTagToList() {
        const input = document.getElementById('post-tag-input');
        const tagText = input.value.trim();
        if (!tagText) return;

        // 自动加 # 号
        const tag = tagText.startsWith('#') ? tagText : '#' + tagText;

        const list = document.getElementById('tag-list');
        // 检查是否已存在
        const existing = list.querySelectorAll('.tag-item span');
        for (const item of existing) {
            if (item.textContent.trim() === tag) {
                this.showNotification('该标签已添加');
                return;
            }
        }

        // 创建标签项
        const item = document.createElement('div');
        item.className = 'tag-item';
        item.style.cssText = 'display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; background: var(--primary); color: white; border-radius: 14px; font-size: 13px;';
        item.innerHTML = `
            <span>${tag}</span>
            <button type="button" style="background: none; border: none; color: white; cursor: pointer; font-size: 14px; padding: 0; line-height: 1;" onclick="this.parentElement.remove();">✕</button>
        `;
        list.appendChild(item);

        input.value = '';
    }

    /** 获取当前标签列表 */
    getTagList() {
        const items = document.querySelectorAll('#tag-list .tag-item span');
        const tags = [];
        items.forEach(item => {
            const tag = item.textContent.trim();
            if (tag) tags.push(tag);
        });
        return tags;
    }

    /**
     * 打开帖子详情页
     */
    openPostDetail(postId, keepScrollPosition = false) {
        const post = this.forumPosts.find(p => p.id === postId);
        if (!post) {
            this.showNotification('该帖子已被删除', 3000);
            return;
        }

        // 确保时间显示为相对时间（与列表页保持一致）
        if (post && post.timestamp) {
            post.time = this.getRelativeTime(new Date(post.timestamp));
        }

        // 防御性初始化
        if (!Array.isArray(post.likedBy)) post.likedBy = [];

        // 保存当前打开的帖子ID
        this.currentDetailPostId = postId;

        // 渲染帖子详情内容
        const detailBody = document.getElementById('post-detail-body');
        if (!detailBody) return;

        // 获取作者信息
        const authorChat = this.getChat(post.authorId);
        let authorName = '匿名网友';
        let authorAvatar = '👤';

        if (authorChat) {
            authorName = authorChat.nickname || authorChat.remarkName || authorChat.name;
            authorAvatar = authorChat.avatar || '👤';
        } else if (post.authorId && post.authorId.startsWith('writer_')) {
            // 写手类型：优先从聊天信息获取，其次使用帖子中存储的作者名称，头像固定为✍️
            const writerChat = this.getChat(post.authorId);
            authorName = writerChat ? (writerChat.nickname || writerChat.remarkName || writerChat.name || post.authorName || '写手太太') : (post.authorName || '写手太太');
            authorAvatar = '✍️';
        } else if (post.authorId && post.authorId.startsWith('npc_')) {
            // 随机NPC类型：尝试从世界书或随机NPC中查找
            let npcInfo = null;
            // 先查世界书中的NPC
            if (this.worldBooks) {
                for (const world of this.worldBooks) {
                    if (world.npcs) {
                        const found = world.npcs.find(n => 'npc_' + n.id === post.authorId);
                        if (found) { npcInfo = found; break; }
                    }
                }
            }
            // 再查随机NPC
            if (!npcInfo && this.randomNPCs) {
                npcInfo = this.randomNPCs.find(n => n.id === post.authorId);
            }
            if (npcInfo) {
                authorName = npcInfo.name;
                authorAvatar = npcInfo.avatar || '👤';
            }
        } else if (post.author) {
            // 兼容旧数据（直接存了作者名）
            authorName = post.author;
            authorAvatar = post.avatar || '👤';
        }

        const likedUsers = [];
        if (post.likedBy && post.likedBy.length > 0) {
            post.likedBy.forEach(userId => {
                // 1. 首先从 chats 中查找（OC 角色），优先用网名
                const chat = this.getChat(userId);
                if (chat) {
                    likedUsers.push(chat.nickname || chat.remarkName || chat.name);
                    return;
                }
                // 2. 从随机 NPC 中查找
                if (this.randomNPCs) {
                    const npc = this.randomNPCs.find(n => n.id === userId);
                    if (npc) {
                        likedUsers.push(npc.name);
                        return;
                    }
                }
                // 3. 兜底：把纯 ID 格式转成可读的昵称
                const cleanName = userId
                    .replace(/^npc_random_\d+_(\d+)$/, '路人网友_$1')
                    .replace(/^npc_fan_(\d+)$/, '粉丝_$1')
                    .replace(/^user_/, '')
                    .replace(/_/g, ' ');
                likedUsers.push(cleanName);
            });
        }

        // 生成作者头像HTML
        const authorAvatarHtml = authorAvatar && (authorAvatar.startsWith('http://') || authorAvatar.startsWith('https://'))
            ? `<img src="${authorAvatar}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null; this.style.display='none'; var fallback = this.parentElement.querySelector('.emoji-fallback'); if (fallback) fallback.style.display='block';"><span class="emoji-fallback" style="display: none;">👤</span>`
            : `<span>${authorAvatar}</span>`;

        // 直接渲染所有评论，不使用 buildCommentTree
        const allComments = post.comments || [];
        let commentHtml = '';

        // 先渲染一级评论（parentId 为 null 的）
        const topComments = allComments.filter(c => !c.parentId);
        // 热评置顶：将点赞数>=5的评论排在前面，其余按时间戳升序（旧的在前）
        topComments.sort((a, b) => {
            const aIsHot = (a.likes || 0) >= 5;
            const bIsHot = (b.likes || 0) >= 5;
            if (aIsHot && !bIsHot) return -1;
            if (!aIsHot && bIsHot) return 1;
            // 同类型按时间戳升序（旧的在前）
            return (a.timestamp || 0) - (b.timestamp || 0);
        });
        const childComments = allComments.filter(c => c.parentId);

        topComments.forEach(comment => {
            commentHtml += this.renderCommentTree(comment, 0);
            // 渲染该评论的所有子回复
            const renderChildren = (parentId, level) => {
                childComments
                    .filter(c => c.parentId === parentId)
                    .forEach(child => {
                        commentHtml += this.renderCommentTree(child, level);
                        renderChildren(child.id, level + 1);
                    });
            };
            renderChildren(comment.id, 1);
        });

        // 渲染帖子内容与评论区
        detailBody.innerHTML =
            `<div class="post-detail-header">` +
                `<div class="post-detail-avatar">${authorAvatarHtml}</div>` +
                `<div class="post-detail-author-info">` +
                    `<div class="post-detail-author-name">${authorName}</div>` +
                    `<div class="post-detail-time">${post.time}</div>` +
                `</div>` +
            `</div>` +
            `<div class="post-detail-title" style="font-size:18px; font-weight:700; margin-bottom:8px; color:var(--text-primary);">${post.title || '无标题'}</div>` +
            `${post.imageUrls && post.imageUrls.length > 0 ? `
                                <div style="display: flex; flex-direction: column; gap: 12px; align-items: center; margin-bottom: 12px;">
                                    ${post.imageUrls.map(url => `
                                        <img src="${url}" style="max-width:100%; max-height:400px; border-radius:12px;" onerror="this.parentElement.innerHTML='<span style=color:var(--text-secondary)>图片加载失败</span>';">
                                    `).join('')}
                                </div>
                            ` : ''}` +
            `<div class="post-detail-content">${post.content}</div>` +
            `${post.tags && post.tags.length > 0 ? '<div class="post-detail-tags">' + post.tags.map(tag => '<span class="post-tag-item">' + tag + '</span>').join(' ') + '</div>' : ''}` +
            `<div class="post-detail-stats">` +
                `<span style="cursor:pointer;" onclick="chatManager.toggleLikeInDetail(${post.id})">❤️ ${post.likes}</span>` +
                `<span>💬 ${post.comments.length}</span>` +
            `</div>` +
            `${likedUsers.length > 0 ? '<div class="post-detail-liked">👍 ' + likedUsers.join('、') + '</div>' : ''}` +
            `<div class="comment-section">` +
                `<h4>评论 (${post.comments.length})</h4>` +
                `<div class="comment-list">` +
                    (commentHtml || '<p style="color:var(--text-secondary); text-align:center;font-size:13px;">暂无评论</p>') +
                `</div>` +
            `</div>`;

        // 显示模态框
        const modal = document.getElementById('post-detail-modal');
        if (modal) {
            modal.classList.add('active');
        }

        // 重置滚动位置到顶部（延迟确保内容渲染完成）
        if (!keepScrollPosition) {
            setTimeout(() => {
                const postDetailBody = document.querySelector('#post-detail-modal .modal-body');
                if (postDetailBody) postDetailBody.scrollTop = 0;
            }, 50);
        }

        // 绑定评论删除事件委托 - 问题4修复
        setTimeout(() => {
            const detailBody = document.getElementById('post-detail-body');
            if (!detailBody) return;
            // 移除旧委托避免重复绑定
            if (detailBody._commentDelegate) {
                detailBody.removeEventListener('click', detailBody._commentDelegate);
            }
            const delegate = (e) => {
                const deleteBtn = e.target.closest('.delete-comment-btn');
                if (deleteBtn) {
                    e.stopPropagation();
                    const commentId = parseInt(deleteBtn.getAttribute('data-comment-id'));
                    const postId = this.currentDetailPostId;
                    if (postId && !isNaN(commentId)) {
                        this.deleteComment(postId, commentId);
                    }
                }
            };
            detailBody.addEventListener('click', delegate);
            detailBody._commentDelegate = delegate;
        }, 100);
    }

    /**
     * 关闭帖子详情弹窗
     */
    closePostDetailModal() {
        const modal = document.getElementById('post-detail-modal');
        if (modal) {
            modal.classList.remove('active');
        }
        this.currentDetailPostId = null;
        this.currentReplyParentId = null;
    }

    /**
     * 打开动态详情弹窗
     * @param {string} dynamicId - 动态ID
     */
    openDynamicDetail(dynamicId) {
        const dynamic = this.dynamics.find(d => d.id === dynamicId);
        if (!dynamic) {
            this.showNotification('动态不存在');
            return;
        }

        // 通过 authorId 获取正确的显示名称
        const authorChat = this.getChat(dynamic.authorId);
        const displayAuthor = this.getDynamicDisplayName(authorChat);

        // 判断头像是否为URL
        const avatar = dynamic.avatar;
        let avatarHtml;
        if (avatar && typeof avatar === 'string' && (avatar.startsWith('http://') || avatar.startsWith('https://'))) {
            avatarHtml = `<img src="${avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
        } else {
            avatarHtml = `<span>${avatar || '👤'}</span>`;
        }

        // 点赞人显示（增加防御判断）
        const likedBy = dynamic.likedBy || [];
        const likesHtml = likedBy.length > 0 ?
            `<div class="dynamic-likes has-likes">❤️ ${likedBy.join('、')}</div>` : '';

        // 渲染评论 - 显示所有评论，区分回复关系
        const commentsHtml = dynamic.comments && dynamic.comments.length > 0 ?
            dynamic.comments.map(comment => {
                let replyToText = '';
                if (comment.replyTo && typeof comment.replyTo === 'string' && comment.replyTo.trim() !== '') {
                    replyToText = ` 回复 <span class="reply-target">@${comment.replyTo}</span>`;
                }
                // 格式化时间
                const timeStr = comment.timestamp ? new Date(comment.timestamp).toLocaleString('zh-CN', { hour12: false }) : '';
                return `
                    <div class="comment-item" data-comment-id="${comment.id}" data-dynamic-id="${dynamic.id}" data-author-id="${comment.authorId}" data-author-name="${comment.authorName}">
                        <div class="comment-header">
                            <span class="comment-author">${comment.authorName}${replyToText}</span>
                            <span class="comment-time">${timeStr}</span>
                        </div>
                        <div class="comment-content">${comment.content}</div>
                        <div class="comment-actions">
                            ${comment.authorId === 'user_mummy' ? `<button class="comment-delete-btn" onclick="chatManager.deleteComment('${dynamic.id}', '${comment.id}')">删除</button>` : ''}
                        </div>
                    </div>
                `;
            }).join('') : '<div class="no-comments">暂无评论</div>';

        // 创建模态框内容
        const modalHtml = `
            <div class="modal" id="dynamic-detail-modal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>动态详情</h3>
                        <button class="close-btn" onclick="chatManager.closeDynamicDetailModal()">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="dynamic-card-content" style="max-width: 100%;">
                            <div class="dynamic-card-header">
                                <div class="dynamic-avatar">${avatarHtml}</div>
                                <div class="dynamic-user-info">
                                    <div class="dynamic-nickname">${displayAuthor}</div>
                                </div>
                            </div>
                            <div class="dynamic-card-preview" style="white-space: pre-wrap; word-wrap: break-word;">${this.escapeHtml(dynamic.content)}</div>
                            ${dynamic.image ? `<img src="${dynamic.image}" style="max-width: 100%; margin-top: 12px; border-radius: 8px;" onerror="this.parentElement.innerHTML='<span style=color:red>图片加载失败</span>';">` : ''}

                            <!-- 点赞人列表显示区域 -->
                            ${likesHtml}

                            <!-- 评论区 -->
                            <div class="dynamic-comments" id="comments-${dynamic.id}">
                                ${commentsHtml}
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="submit-btn" onclick="chatManager.closeDynamicDetailModal()">关闭</button>
                    </div>
                </div>
            </div>
        `;

        // 移除已存在的模态框（如果有的话）
        const existingModal = document.getElementById('dynamic-detail-modal');
        if (existingModal) {
            existingModal.remove();
        }

        // 添加模态框到文档
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // 显示模态框
        const modal = document.getElementById('dynamic-detail-modal');
        if (modal) {
            modal.classList.add('active');
        }
    }

    /**
     * 关闭动态详情弹窗
     */
    closeDynamicDetailModal() {
        const modal = document.getElementById('dynamic-detail-modal');
        if (modal) {
            modal.classList.remove('active');
        }
    }

    /**
     * 构建评论树结构
     */
    buildCommentTree(comments, parentId = null) {
        if (!Array.isArray(comments)) return [];

        const tree = [];
        comments.forEach(comment => {
            if (comment.parentId === parentId) {
                const children = this.buildCommentTree(comments, comment.id);
                if (children.length > 0) {
                    comment.replies = children;
                }
                tree.push(comment);
            }
        });
        return tree;
    }

    /**
     * 渲染评论树
     */
    renderCommentTree(comment, level = 0) {
        const authorChat = this.getChat(comment.authorId);
        let authorName = '匿名';
        let authorAvatar = '👤';

        if (authorChat) {
            authorName = authorChat.nickname || authorChat.name;
            authorAvatar = authorChat.avatar || '👤';
        } else if (comment.authorId.startsWith('npc_')) {
            // 先尝试从 randomNPCs 查找
            const randomNPC = this.randomNPCs?.find(npc => npc.id === comment.authorId);
            if (randomNPC) {
                authorName = randomNPC.name;
                authorAvatar = randomNPC.avatar;
            } else {
                // 兜底：解析 npc_random_1234567890_6 -> 路人网友_6
                const match = comment.authorId.match(/^npc_random_\d+_(\d+)$/);
                if (match) {
                    authorName = '路人网友_' + match[1];
                } else {
                    // 尝试从世界书 NPC 查找
                    const worldNPC = this.findNPCData(comment.authorId);
                    if (worldNPC) {
                        authorName = worldNPC.name;
                        authorAvatar = worldNPC.avatar || '👤';
                    } else {
                        // 最终兜底
                        authorName = comment.authorId.replace(/^npc_/, '').replace(/_/g, ' ') || '神秘角色';
                    }
                }
                authorAvatar = '👤';
            }
        } else {
            // 尝试从 randomNPCs 查找
            const randomNPC = this.randomNPCs?.find(npc => npc.id === comment.authorId);
            if (randomNPC) {
                authorName = randomNPC.name;
                authorAvatar = randomNPC.avatar;
            } else {
                // 兜底：把原始 ID 转为可读名
                // npc_random_1234567890_6 -> 路人网友_6
                const match = comment.authorId.match(/^npc_random_\d+_(\d+)$/);
                if (match) {
                    authorName = '路人网友_' + match[1];
                } else {
                    // 其他格式的兜底
                    authorName = comment.authorId
                        .replace(/^npc_/, '')
                        .replace(/^random_/, '')
                        .replace(/_/g, ' ')
                        .replace(/\d+/g, '')
                        .trim() || '路人网友';
                }
                authorAvatar = '👤';
            }
        }

        const marginLeft = level > 0 ? `${level * 20}px` : '0';

        // 所有评论都显示编辑和删除按钮 - 问题4修复：删除按钮使用data属性而非onclick
        const editButton = `<button class="edit-comment-btn" onclick="chatManager.editComment(${this.currentDetailPostId}, ${comment.id}, event)">✏️</button>`;
        const deleteButton = `<button class="delete-comment-btn" data-comment-id="${comment.id}">🗑️</button>`;

        let html = `<div class="comment-item" style="margin-left:${marginLeft};">` +
            `<div class="comment-author-avatar">${authorAvatar}</div>` +
            `<div class="comment-content-wrapper">` +
                `<div style="display:flex; justify-content:space-between; align-items:flex-start; width:100%;">` +
                    `<span class="comment-author-name">${authorName}:</span>` +
                    `<span class="comment-time" style="flex-shrink:0; margin-left:8px;">${comment.time}</span>` +
                `</div>` +
                `<div class="comment-text">${(comment.likes || 0) >= 5 ? '<span class="hot-comment-badge">🔥热评</span>' : ''}${comment.content}</div>` +
                `<div class="comment-reactions">
                    <span class="reaction-like clickable" onclick="chatManager.toggleCommentReaction(${comment.id}, 'like')">👍 <span class="like-count">${comment.likes || 0}</span></span>
                    <span class="reaction-dislike clickable" onclick="chatManager.toggleCommentReaction(${comment.id}, 'dislike')">👎 <span class="dislike-count">${comment.dislikes || 0}</span></span>
                </div>` +
                `<div class="comment-actions" style="text-align:right; margin-top:4px;">` +
                    `<button class="reply-btn" onclick="chatManager.replyToComment(${comment.id})">回复</button>` +
                    `${editButton}` +
                    `${deleteButton}` +
                `</div>` +
            `</div>` +
        `</div>`;

        if (comment.replies && comment.replies.length > 0) {
            comment.replies.forEach(reply => {
                html += this.renderCommentTree(reply, level + 1);
            });
        }
        return html;
    }

    /**
     * 回复评论
     */
    replyToComment(commentId) {
        this.currentReplyParentId = commentId;

        // 找到被回复的评论内容
        const post = this.forumPosts.find(p => p.id === this.currentDetailPostId);
        if (post && post.comments) {
            const targetComment = post.comments.find(c => c.id === commentId);
            if (targetComment) {
                // 使用与 renderCommentTree 完全相同的名字解析逻辑
                let authorName = '匿名';
                const authorChat = this.getChat(targetComment.authorId);
                if (authorChat) {
                    authorName = authorChat.nickname || authorChat.remarkName || authorChat.name;
                } else if (targetComment.authorId.startsWith('npc_')) {
                    const randomNPC = this.randomNPCs?.find(npc => npc.id === targetComment.authorId);
                    if (randomNPC) {
                        authorName = randomNPC.name;
                    } else {
                        const match = targetComment.authorId.match(/^npc_random_\d+_(\d+)$/);
                        if (match) {
                            authorName = '路人网友_' + match[1];
                        } else {
                            const worldNPC = this.findNPCData(targetComment.authorId);
                            if (worldNPC) {
                                authorName = worldNPC.name;
                            } else {
                                authorName = targetComment.authorId.replace(/^npc_/, '').replace(/_/g, ' ') || '神秘角色';
                            }
                        }
                    }
                } else {
                    const randomNPC = this.randomNPCs?.find(npc => npc.id === targetComment.authorId);
                    if (randomNPC) {
                        authorName = randomNPC.name;
                    } else {
                        authorName = targetComment.authorId || '匿名';
                    }
                }
                const maxLen = 15; // 控制预览字数
                const contentPreview = targetComment.content.length > maxLen ? targetComment.content.substring(0, maxLen) + '...' : targetComment.content;
                document.getElementById('reply-text').textContent = `回复 @${authorName}：${contentPreview}`;
            }
        }

        // 显示回复提示
        const replyInfo = document.getElementById('reply-info');
        if (replyInfo) {
            replyInfo.style.display = 'block';
            replyInfo.classList.add('active');
        }

        // 聚焦到评论输入框
        const commentInput = document.getElementById('post-comment-input');
        if (commentInput) {
            commentInput.focus();
        }
    }

    /**
     * 切换评论的赞/踩状态
     */
    toggleCommentReaction(commentId, type) {
        const postId = this.currentDetailPostId;
        if (!postId) return;
        const post = this.forumPosts.find(p => p.id === postId);
        if (!post) return;
        const comment = post.comments.find(c => c.id === commentId);
        if (!comment) return;

        // 保存旧点赞数，用于判断是否跨过5的阈值
        const oldLikes = comment.likes || 0;

        // 检查是否已经点过
        const alreadyLiked = comment.likedBy?.includes('user_mummy');
        const alreadyDisliked = comment.dislikedBy?.includes('user_mummy');

        if (type === 'like') {
            if (alreadyLiked) {
                comment.likes = Math.max(0, (comment.likes || 0) - 1);
                comment.likedBy = comment.likedBy.filter(id => id !== 'user_mummy');
            } else {
                comment.likes = (comment.likes || 0) + 1;
                comment.likedBy = comment.likedBy || [];
                comment.likedBy.push('user_mummy');
                // 如果之前踩过，取消踩
                if (alreadyDisliked) {
                    comment.dislikes = Math.max(0, (comment.dislikes || 0) - 1);
                    comment.dislikedBy = comment.dislikedBy.filter(id => id !== 'user_mummy');
                }
            }
        } else if (type === 'dislike') {
            if (alreadyDisliked) {
                comment.dislikes = Math.max(0, (comment.dislikes || 0) - 1);
                comment.dislikedBy = comment.dislikedBy.filter(id => id !== 'user_mummy');
            } else {
                comment.dislikes = (comment.dislikes || 0) + 1;
                comment.dislikedBy = comment.dislikedBy || [];
                comment.dislikedBy.push('user_mummy');
                // 如果之前赞过，取消赞
                if (alreadyLiked) {
                    comment.likes = Math.max(0, (comment.likes || 0) - 1);
                    comment.likedBy = comment.likedBy.filter(id => id !== 'user_mummy');
                }
            }
        }

        localStorage.setItem('forumData', JSON.stringify(this.forumPosts));

        // 如果赞数跨过5，立即刷新评论排序
        const newLikes = comment.likes || 0;
        if ((oldLikes < 5 && newLikes >= 5) || (oldLikes >= 5 && newLikes < 5)) {
            this.openPostDetail(postId, true);
        }

        // 局部更新赞踩数字，避免整页刷新导致滚动回顶部
        const likeSpan = document.querySelector(`.reaction-like[onclick*="${commentId}"] .like-count`);
        const dislikeSpan = document.querySelector(`.reaction-dislike[onclick*="${commentId}"] .dislike-count`);
        if (likeSpan) likeSpan.textContent = comment.likes || 0;
        if (dislikeSpan) dislikeSpan.textContent = comment.dislikes || 0;

        // 更新热评标识（如果赞数跨过5的阈值）
        const commentTextDiv = document.querySelector(`.comment-item[style*="${commentId}"] .comment-text`)
            || document.querySelector(`.reaction-like[onclick*="${commentId}"]`).closest('.comment-content-wrapper').querySelector('.comment-text');
        if (commentTextDiv) {
            const existingBadge = commentTextDiv.querySelector('.hot-comment-badge');
            if ((comment.likes || 0) >= 5 && !existingBadge) {
                const badge = document.createElement('span');
                badge.className = 'hot-comment-badge';
                badge.textContent = '🔥热评';
                commentTextDiv.insertBefore(badge, commentTextDiv.firstChild);
            } else if ((comment.likes || 0) < 5 && existingBadge) {
                existingBadge.remove();
            }
        }
    }

    /**
     * 取消回复
     */
    cancelReply() {
        this.currentReplyParentId = null;

        const replyInfo = document.getElementById('reply-info');
        if (replyInfo) {
            replyInfo.style.display = 'none';
        }
    }

    /**
     * 编辑评论
     */
    editComment(postId, commentId, event) {
        if (event) event.stopPropagation();
        const post = this.forumPosts.find(p => p.id === postId);
        if (!post || !post.comments) return;
        const comment = post.comments.find(c => c.id === commentId);
        if (!comment) return;

        // 创建编辑模态框
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.style.zIndex = '3000';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 360px;">
                <div class="modal-header">
                    <h3>编辑评论</h3>
                    <button class="close-btn" id="edit-comment-close">✕</button>
                </div>
                <div class="modal-body">
                    <textarea id="edit-comment-input" style="width:100%; height:80px; padding:10px; border:1px solid var(--border); border-radius:8px; font-size:14px; resize:vertical;">${comment.content}</textarea>
                </div>
                <div class="modal-footer">
                    <button class="cancel-btn" id="edit-comment-cancel">取消</button>
                    <button class="submit-btn" id="edit-comment-save">保存</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const input = modal.querySelector('#edit-comment-input');
        const closeBtn = modal.querySelector('#edit-comment-close');
        const cancelBtn = modal.querySelector('#edit-comment-cancel');
        const saveBtn = modal.querySelector('#edit-comment-save');

        const closeModal = () => modal.remove();

        closeBtn.onclick = closeModal;
        cancelBtn.onclick = closeModal;

        saveBtn.onclick = () => {
            const newContent = input.value.trim();
            if (newContent) {
                comment.content = newContent;
                localStorage.setItem('forumData', JSON.stringify(this.forumPosts));
                this.renderForum();
                this.openPostDetail(postId);
            }
            closeModal();
        };

        // 点击遮罩关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });

        // 聚焦输入框
        setTimeout(() => input.focus(), 100);
    }

    /**
     * 添加评论到当前帖子
     */
    addCommentToCurrentPost(content, parentId = null) {
        const postId = this.currentDetailPostId;
        if (!postId) return;

        const post = this.forumPosts.find(p => p.id === postId);
        if (!post) return;

        if (!content) {
            content = prompt('请输入评论内容：');
            if (!content) return;
        }

        // 固定 authorId 为 'user_mummy'
        const authorId = 'user_mummy';

        const newComment = {
            id: Date.now(),
            authorId: authorId,
            content: content,
            time: this.getRelativeTime(new Date()),
            timestamp: new Date().toISOString(),
            parentId: parentId
        };

        if (!post.comments) post.comments = [];
        post.comments.unshift(newComment);

        // 更新帖子评论数
        post.commentsCount = post.comments.length;

        // 保存到localStorage
        localStorage.setItem('forumData', JSON.stringify(this.forumPosts));

        // 重新渲染论坛列表
        this.renderForum();

        // 重新渲染详情页
        this.openPostDetail(postId);

        // 触发被@角色的回复
        this.triggerMentionedReply(postId, content);

        // 清除回复状态
        this.cancelReply();

        // AI回复功能待实现
    }

    /**
     * 从输入框添加评论
     */
    addCommentFromInput() {
        const input = document.getElementById('post-comment-input');
        const content = input.value.trim();
        if (!content) return;

        this.addCommentToCurrentPost(content, this.currentReplyParentId);

        // 清空输入框
        input.value = '';

        // AI回复功能待实现
    }

    /**
     * 删除评论
     */
    deleteComment(postId, commentId) {
        const modal = document.getElementById('confirm-modal');
        const title = document.getElementById('confirm-modal-title');
        const message = document.getElementById('confirm-modal-message');
        const confirmBtn = document.getElementById('confirm-confirm-btn');
        const cancelBtn = document.getElementById('confirm-cancel-btn');

        if (!modal || !title || !message) return;

        title.textContent = '删除评论';
        message.textContent = '确定要删除这条评论吗？';
        modal.classList.add('active');

        const onConfirm = () => {
            const post = this.forumPosts.find(p => p.id === postId);
            if (!post || !post.comments) {
                modal.classList.remove('active');
                return;
            }

            // 递归获取要删除的所有评论 ID（包括子评论）
            const getIdsToDelete = (comments, targetId) => {
                let ids = [targetId];
                comments.forEach(comment => {
                    if (comment.parentId === targetId) {
                        ids = ids.concat(getIdsToDelete(comments, comment.id));
                    }
                });
                return ids;
            };

            const idsToDelete = getIdsToDelete(post.comments, commentId);
            // 过滤掉这些 ID 的评论
            post.comments = post.comments.filter(comment => !idsToDelete.includes(comment.id));
            // 更新评论数
            post.commentsCount = post.comments.length;

            // 保存并刷新 - 问题4修复：确保删除后刷新详情页
            localStorage.setItem('forumData', JSON.stringify(this.forumPosts));
            this.renderForum();
            // 重新打开当前帖子详情页以刷新评论列表
            this.openPostDetail(postId);
            this.showNotification('评论已删除');

            modal.classList.remove('active');
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
        };

        const onCancel = () => {
            modal.classList.remove('active');
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
        };

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
    }

    /**
     * 根据关键词生成NPC回复
     */
    generateNPCReplyForKeyword(postId, keyword) {
        const post = this.forumPosts.find(p => p.id === postId);
        if (!post) return;

        // 调用 getNPCsByKeyword 获取相关NPC列表
        const relatedNPCs = this.getNPCsByKeyword(keyword, post.authorId);
        if (relatedNPCs.length === 0) return;

        // 确保被@的角色一定会生成一条评论
        let selectedNPCs = [];

        // 如果有被@的用户在relatedNPCs中，优先选择
        if (post.mentionedUsers && post.mentionedUsers.length > 0) {
            post.mentionedUsers.forEach(userId => {
                const mentionedNPC = relatedNPCs.find(npc => npc.id === userId);
                if (mentionedNPC) {
                    selectedNPCs.push(mentionedNPC);
                }
            });
        }

        // 如果没有找到被@的用户，则随机选择1~2个NPC
        if (selectedNPCs.length === 0) {
            const npcCount = Math.min(Math.floor(Math.random() * 2) + 1, relatedNPCs.length);
            for (let i = 0; i < npcCount; i++) {
                selectedNPCs.push(relatedNPCs[i % relatedNPCs.length]);
            }
        }

        // 为每个选中的NPC生成评论
        setTimeout(() => {
            selectedNPCs.forEach((npc, i) => {
                setTimeout(() => {
                    // 根据关键词选择合适的回复模板
                    let templates = [
                        '太好磕了！', '太太产粮了！', '支持支持！', '说得太好了！',
                        '完全赞同！', '就是这个感觉！', '太对了！', '支持太太！'
                    ];

                    // 针对特定关键词的回复
                    if (keyword.includes('薛厉') || keyword.includes('明日')) {
                        templates = ['薛厉明日CP粉表示支持！', '太好磕了！', '太太产粮了！', '薛厉明日永远的神！'];
                    } else if (keyword.includes('狼羊')) {
                        templates = ['狼羊组万岁！', '支持狼羊组！', '狼羊组最棒！', '狼羊组YYDS！'];
                    }

                    const content = templates[Math.floor(Math.random() * templates.length)];

                    const npcComment = {
                        id: Date.now() + i,
                        authorId: npc.id,
                        content: content,
                        time: this.getRelativeTime(new Date()),
                        timestamp: new Date().toISOString(),
                        isAuto: true
                    };

                    if (!post.comments) post.comments = [];
                    post.comments.push(npcComment);
                    localStorage.setItem('forumData', JSON.stringify(this.forumPosts));
                    this.renderForum();
                    this.openPostDetail(postId);
                }, i * 1000);
            });
        }, 2000);
    }

    /**
     * 检查容器内容是否填满，如果不足则自动加载更多
     */
    _checkAndFillContainer(containerId, listType) {
        const container = document.getElementById(containerId);
        if (!container) return;
        // 延迟检查，等浏览器布局完成
        setTimeout(() => {
            if (container.scrollHeight <= container.clientHeight + 50 && this[`${listType}HasMore`]) {
                console.log(`[自动填充] ${listType} 内容不足，自动加载更多`);
                this.loadMore(listType);
            }
        }, 300);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    const overlay = document.createElement('div');
    overlay.id = 'overlay';
    overlay.className = 'overlay';
    document.querySelector('.phone-container').appendChild(overlay);
    overlay.onclick = () => { if (window.chatManager) window.chatManager.closeAllPanels(); };
    window.chatManager = new ChatManager();
    window.chatManager.renderChatList();
    window.chatManager.applyMammySettings();
    setInterval(() => { if (window.chatManager) window.chatManager.updateTimeLabels(); }, 60000);

    // 搜索按钮事件绑定
    document.addEventListener('click', function(e) {
        if (e.target.closest('#forum-search-bar button') && window.chatManager) {
            window.chatManager.searchAll();
        }
    });
    // 搜索框回车事件绑定
    document.addEventListener('keypress', function(e) {
        if (e.target.id === 'tag-search-input' && e.key === 'Enter' && window.chatManager) {
            window.chatManager.searchAll();
        }
    });
    const navItems = document.querySelectorAll('.nav-item');
    const pages = document.querySelectorAll('.page');
    navItems.forEach(item => {
        item.addEventListener('click', function() {
            const targetPage = this.getAttribute('data-page');
            navItems.forEach(nav => nav.classList.remove('active'));
            pages.forEach(page => page.classList.remove('active'));
            this.classList.add('active');
            const targetPageEl = document.getElementById(`${targetPage}-page`);
            if (targetPageEl) targetPageEl.classList.add('active');
            if (targetPage === 'message') window.chatManager.renderChatList();
        });
    });

    // 发帖按钮事件
    const createPostBtn = document.getElementById('create-post-btn');
    if (createPostBtn) {
        createPostBtn.onclick = () => {
            chatManager.showCreatePostModal();
        };
    }

    // 论坛刷新按钮
    const refreshForumBtn = document.getElementById('refresh-forum-btn');
    if (refreshForumBtn) {
        refreshForumBtn.onclick = () => {
            chatManager.refreshForumPosts();
        };
    }

    // 已注释：此全局监听器与 bindEmojiEvents 中的事件委托冲突
    // document.addEventListener('click', function(e) {
    //     if (e.target.classList.contains('emoji-item')) {
    //         const emoji = e.target.getAttribute('data-emoji');
    //         const msgInput = document.getElementById('msg-input');
    //         msgInput.value += emoji;
    //         msgInput.dispatchEvent(new Event('input'));
    //     }
    // });
    window.showAvatarAlert = () => this.showNotification('头像功能待开发！');
    // document.addEventListener('touchmove', function(e) {
    //     if (e.target.closest('.page')) e.preventDefault();
    // }, { passive: false });

    // 页面关闭前清理所有定时器
    window.addEventListener('beforeunload', () => {
        if (window.chatManager) {
            window.chatManager.autoReplyTimers.forEach((timer, chatId) => {
                clearInterval(timer);
            });
            if (chatManager.autoDynamicTimer) clearInterval(chatManager.autoDynamicTimer);
        }
    });
});