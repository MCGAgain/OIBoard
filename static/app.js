const { createApp, ref, shallowRef, markRaw, onMounted, onUnmounted, computed, nextTick, watch } = Vue;

createApp({
  setup() {
    // --- Auth State ---
    let cachedUser = null;
    try {
      cachedUser = JSON.parse(localStorage.getItem("oiboard_user") || "null");
    } catch (e) {
      cachedUser = null;
    }

    const token = ref(localStorage.getItem("oiboard_token") || "");
    const currentUser = ref(cachedUser);
    const isAuthChecking = ref(!!token.value && !currentUser.value);
    const isLoggedIn = computed(() => !!currentUser.value);
    
    const authMode = ref("login"); // 'login' | 'register'
    const authForm = ref({ username: "", password: "", confirmPassword: "", captcha_code: "" });
    const authError = ref("");
    const isAuthLoading = ref(false);
    const showAuthPwd = ref(false);
    const captchaId = ref("");
    const captchaImage = ref("");

    const pwdForm = ref({ oldPassword: "", newPassword: "", confirmNewPassword: "" });
    const isChangingPwd = ref(false);
    const showChangePwd = ref(false);

    // --- Dashboard & Platform State ---
    const overview = ref({
      stats: { total_ac: 0, total_subs: 0, today_ac: 0, today_ac_subs: 0, today_subs: 0, streak: 0, platforms: {} },
      platforms_status: [],
      last_sync_time: "",
      climbing_curve: [],
      daily_effort: [],
      local_code: { total_lines: 0, today_lines: 0, total_files: 0, today_files: 0, c_lines: 0, cpp_lines: 0, java_lines: 0, has_data: false }
    });

    const TAB_ORDER = ["overview", "contests", "submissions", "mistakes", "settings"];
    const currentTab = ref("overview"); // 'overview', 'contests', 'submissions', 'mistakes', 'settings'
    const activeTabIndex = computed(() => Math.max(0, TAB_ORDER.indexOf(currentTab.value)));
    const routeProgress = ref(""); // '' | 'active' | 'done'
    let routeProgressTimer = null;

    const animateHydroTabEnter = (tab, direction = 1) => {
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      nextTick(() => {
        const panel = document.getElementById(`tab-panel-${tab}`);
        if (!panel || typeof panel.animate !== "function") return;
        const offset = direction >= 0 ? 18 : -16;
        try {
          panel.getAnimations().forEach(a => a.cancel());
          panel.animate(
            [
              { opacity: 0, transform: `translateY(${offset}px) scale(0.994)` },
              { opacity: 1, transform: "translateY(0) scale(1)" }
            ],
            { duration: 280, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "both" }
          );
          const children = Array.from(panel.children).slice(0, 4);
          children.forEach((child, idx) => {
            if (typeof child.animate !== "function") return;
            child.animate(
              [
                { opacity: 0.35, transform: `translateY(${direction >= 0 ? 10 : -8}px)` },
                { opacity: 1, transform: "translateY(0)" }
              ],
              { duration: 260, delay: idx * 35, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "both" }
            );
          });
        } catch (e) {}
      });
    };

    const triggerRouteTransition = (tab, direction = 1) => {
      if (routeProgressTimer) clearTimeout(routeProgressTimer);
      routeProgress.value = "active";
      animateHydroTabEnter(tab, direction);
    };

    const finishRouteTransition = () => {
      if (routeProgressTimer) clearTimeout(routeProgressTimer);
      routeProgress.value = "done";
      routeProgressTimer = setTimeout(() => {
        routeProgress.value = "";
        routeProgressTimer = null;
      }, 320);
    };

    const getLocalDateStr = (offsetDays = 0) => {
      const d = new Date();
      if (offsetDays) d.setDate(d.getDate() + offsetDays);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };
    const searchKeyword = ref("");
    const debouncedSearchKeyword = ref("");
    let searchDebounceTimer = null;
    watch(searchKeyword, (val) => {
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        debouncedSearchKeyword.value = val;
        currentPage.value = 1;
      }, 150);
    });
    const dateFilter = ref("all"); // 'all', 'today', '7d', '30d', 'year', 'custom'
    const startDate = ref("");
    const endDate = ref("");
    const verdictFilter = ref("all"); // 'all', 'AC', 'WA'
    const selectedTag = ref("");
    const currentPage = ref(1);
    const pageSize = ref(30);
    const submissionsTotal = ref(0);
    const isSubmissionsLoading = ref(false);

    const rawHeatmap = ref([]);
    const heatmapFilter = ref("all");
    const selectedHeatmapYear = ref(new Date().getFullYear());
    const availableHeatmapYears = ref([new Date().getFullYear()]);
    const heatmapLegendTips = ref(["1 发", "2-3 发", "4-6 发", "≥7 发"]);
    const tagStats = ref([]);
    const mistakes = ref([]);
    const dueMistakesList = ref([]);
    const mistakesCounts = ref({ total: 0, due: 0, in_progress: 0, mastered: 0 });
    const mistakeKeySet = ref(new Set());
    const mistakeStatusFilter = ref("all");
    const mistakePlatformFilter = ref("all");
    const mistakeSearch = ref("");
    const mistakeTagFilter = ref("");
    const mistakeSortBy = ref("last_submitted_at");
    const mistakePage = ref(1);
    const mistakePageSize = ref(30);
    const mistakeTotal = ref(0);
    const isMistakesLoading = ref(false);

    const mistakeModalOpen = ref(false);
    const isMistakeEditing = ref(false);
    const mistakeFormTab = ref("write");
    const mistakeForm = ref({
      id: null,
      platform: "luogu",
      problem_id: "",
      problem_title: "",
      difficulty: "",
      tags_input: "",
      key_point: "",
      notes: "",
      problem_url: "",
      last_submitted_at: "",
      last_submission_id: ""
    });
    const isMistakeSaving = ref(false);

    const viewNoteModalOpen = ref(false);
    const activeMistake = ref(null);

    // --- View Mistake Note Modal Sizing & Persistence ---
    const savedNoteModalSize = localStorage.getItem("oiboard_note_modal_size") || "default";
    const noteModalSize = ref(savedNoteModalSize); // 'default', 'wide', 'full', 'custom'
    const isResizingNoteModal = ref(false);
    const noteBackdropPress = ref(false);
    let initialNoteW = null;
    let initialNoteH = null;
    if (savedNoteModalSize === "custom") {
      const savedW = parseInt(localStorage.getItem("oiboard_note_modal_w") || "0", 10);
      const savedH = parseInt(localStorage.getItem("oiboard_note_modal_h") || "0", 10);
      if (savedW && savedW >= 360) {
        initialNoteW = Math.min(savedW, window.innerWidth - 24);
      }
      if (savedH && savedH >= 280) {
        initialNoteH = Math.min(savedH, window.innerHeight - 24);
      }
    }
    const noteModalCustomWidth = ref(initialNoteW);
    const noteModalCustomHeight = ref(initialNoteH);

    const setNoteModalSize = (size) => {
      noteModalSize.value = size;
      localStorage.setItem("oiboard_note_modal_size", size);
    };

    const toggleNoteModalMaximize = () => {
      if (noteModalSize.value === "full") {
        setNoteModalSize("default");
      } else {
        setNoteModalSize("full");
      }
    };

    const startNoteModalResize = (e) => {
      e.preventDefault();
      e.stopPropagation();

      const modalEl = document.getElementById("view-note-modal-dialog");
      if (!modalEl) return;

      const rect = modalEl.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      isResizingNoteModal.value = true;
      modalEl.style.transition = "none";
      document.body.style.userSelect = "none";
      document.body.style.cursor = "nwse-resize";

      const handleEl = e.currentTarget || e.target;
      const hasPointerCapture = e.pointerId && typeof handleEl.setPointerCapture === "function";
      if (hasPointerCapture) {
        try {
          handleEl.setPointerCapture(e.pointerId);
        } catch (err) {}
      }

      let resizeRafId = null;
      let pendingW = null;
      let pendingH = null;

      const onPointerMove = (moveEvent) => {
        moveEvent.preventDefault();

        const minW = 460;
        const maxW = Math.max(minW, window.innerWidth - 24);
        const minH = 320;
        const maxH = Math.max(minH, window.innerHeight - 24);

        // 视口居中弹窗：根据鼠标相对于中心点距离等比计算宽高，实现 1:1 绝对贴手拖拽
        const targetW = Math.round((moveEvent.clientX - centerX) * 2);
        const targetH = Math.round((moveEvent.clientY - centerY) * 2);

        pendingW = Math.min(Math.max(targetW, minW), maxW);
        pendingH = Math.min(Math.max(targetH, minH), maxH);

        // 使用 requestAnimationFrame 进行节流，避免高刷新率鼠标高频触发 Vue 响应式计算
        if (!resizeRafId) {
          resizeRafId = requestAnimationFrame(() => {
            resizeRafId = null;
            if (pendingW !== null && pendingH !== null) {
              noteModalSize.value = "custom";
              noteModalCustomWidth.value = pendingW;
              noteModalCustomHeight.value = pendingH;
            }
          });
        }
      };

      const onPointerUp = (upEvent) => {
        if (resizeRafId) {
          cancelAnimationFrame(resizeRafId);
          resizeRafId = null;
        }
        if (pendingW !== null && pendingH !== null) {
          noteModalSize.value = "custom";
          noteModalCustomWidth.value = pendingW;
          noteModalCustomHeight.value = pendingH;
        }

        if (hasPointerCapture && upEvent && upEvent.pointerId) {
          try {
            handleEl.releasePointerCapture(upEvent.pointerId);
          } catch (err) {}
        }

        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
        window.removeEventListener("mousemove", onPointerMove);
        window.removeEventListener("mouseup", onPointerUp);

        if (handleEl) {
          handleEl.removeEventListener("pointermove", onPointerMove);
          handleEl.removeEventListener("pointerup", onPointerUp);
          handleEl.removeEventListener("pointercancel", onPointerUp);
        }

        modalEl.style.transition = "";
        document.body.style.userSelect = "";
        document.body.style.cursor = "";

        setTimeout(() => {
          isResizingNoteModal.value = false;
        }, 120);

        if (noteModalSize.value === "custom") {
          localStorage.setItem("oiboard_note_modal_size", "custom");
          if (noteModalCustomWidth.value) {
            localStorage.setItem("oiboard_note_modal_w", String(noteModalCustomWidth.value));
          }
          if (noteModalCustomHeight.value) {
            localStorage.setItem("oiboard_note_modal_h", String(noteModalCustomHeight.value));
          }
        }
      };

      if (hasPointerCapture) {
        handleEl.addEventListener("pointermove", onPointerMove);
        handleEl.addEventListener("pointerup", onPointerUp);
        handleEl.addEventListener("pointercancel", onPointerUp);
      }
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
      window.addEventListener("mousemove", onPointerMove);
      window.addEventListener("mouseup", onPointerUp);
    };

    const submissions = shallowRef([]);
    const subFilter = ref("all");

    // --- Contests State ---
    const contests = ref([]);
    const contestFilter = ref("all"); // 'all', 'codeforces', 'atcoder', 'luogu'
    const contestStatusFilter = ref("all"); // 'all', 'BEFORE', 'CODING'
    const contestSearch = ref("");
    const isSyncingContests = ref(false);
    const nowTimestamp = ref(Math.floor(Date.now() / 1000));

    const configs = ref({
      poll_interval_minutes: "1440",
      sprint_mode: "false",
      last_sync_time: "",
      http_proxy: ""
    });

    const platformStatusMap = ref({});
    const isSyncing = ref(false);
    const isSaving = ref(false);
    const isSavingSystem = ref(false);
    const isVerifying = ref({ codeforces: false, luogu: false, acwing: false, atcoder: false });

    // --- Multi-Account Management State ---
    const accounts = ref([]);
    const isAccountSyncing = ref({});
    const isAccountTesting = ref({});
    const accountModalOpen = ref(false);
    const accountModalMode = ref("add"); // 'add' | 'edit'
    const accountForm = ref({ id: null, platform: "codeforces", handle: "", cookie: "", alias: "", is_primary: false });
    const isAccountSubmitting = ref(false);

    const platformMetaList = [
      { id: "codeforces", name: "Codeforces", dotColor: "bg-blue-500" },
      { id: "atcoder", name: "AtCoder", dotColor: "bg-purple-500" },
      { id: "luogu", name: "洛谷", dotColor: "bg-emerald-500" },
      { id: "acwing", name: "AcWing", dotColor: "bg-indigo-500" },
      { id: "leetcode", name: "力扣", dotColor: "bg-amber-500" }
    ];

    const groupedAccounts = computed(() => {
      const map = { codeforces: [], atcoder: [], luogu: [], acwing: [], leetcode: [] };
      for (const a of accounts.value) {
        if (map[a.platform]) {
          map[a.platform].push(a);
        }
      }
      return map;
    });

    const getPlatformName = (platform) => {
      const found = platformMetaList.find(p => p.id === platform);
      return found ? found.name : platform;
    };

    const settingsForm = ref({
      poll_interval_minutes: "1440",
      http_proxy: ""
    });

    const showGuide = ref(false);
    const toast = ref({ show: false, message: "", type: "success" });
    const warningBanner = ref("");

    // ECharts 实例引用
    let heatmapChart = null;
    let analyticsChart = null;
    const chartView = ref("climbing"); // 'climbing' | 'daily' | 'tags' | 'platforms'
    const isCurveSmooth = ref(true); // 累计曲线是否启用高斯核自然平滑拟合

    // --- Contest Computed & Helpers 字典引用 ---
    const contestMetaMap = ref({});

    // --- 跨用户缓存签名与调度状态 (退出登录/会话过期时集中重置) ---
    let lastKnownTotalSubs = -1;
    let lastKnownSyncTime = "";
    let lastHeatmapDataStr = "";
    let lastHeatmapRenderKey = "";
    let lastHeatmapCanvasW = 0;
    let lastHeatmapCanvasH = 0;
    let lastClimbingKey = "";
    let lastDailyKey = "";
    let lastTagChartKey = "";
    let lastPieKey = "";
    let lastTagsHash = "";
    let settingsBaseline = {
      poll_interval_minutes: "1440",
      http_proxy: "",
      sprint_mode: "false"
    };

    // --- 热力图两级本地缓存 (内存 Map + 按用户隔离的 localStorage) 与防竞态/预取控制 ---
    const HEATMAP_PAST_YEAR_TTL_MS = 6 * 60 * 60 * 1000;   // 往年数据几乎不变，缓存 6 小时
    const HEATMAP_CURR_YEAR_TTL_MS = 60 * 1000;            // 当年数据缓存 60 秒（超期先秒开旧缓存再后台静默刷新）
    const heatmapMemoryCache = new Map();                  // key: `${platform}:${year}` -> { heatmap, str, ts }
    const heatmapYearDatesCache = new Map();               // key: year -> Array<'YYYY-MM-DD'>
    let heatmapCacheHydratedUid = null;
    let heatmapRequestSeq = 0;
    let heatmapPrefetchGen = 0;
    let heatmapPrefetchTimer = null;

    const getHeatmapStorageKey = () => {
      const uid = currentUser.value?.id;
      return uid ? `oiboard_heatmap_cache_v1_${uid}` : null;
    };

    const hydrateHeatmapCache = () => {
      const uid = currentUser.value?.id || null;
      if (!uid || heatmapCacheHydratedUid === uid) return;
      heatmapMemoryCache.clear();
      heatmapCacheHydratedUid = uid;
      try {
        const raw = localStorage.getItem(`oiboard_heatmap_cache_v1_${uid}`);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          if (Array.isArray(parsed.available_years) && parsed.available_years.length > 0 && availableHeatmapYears.value.length <= 1) {
            availableHeatmapYears.value = parsed.available_years;
          }
          const entries = parsed.entries || {};
          for (const [k, v] of Object.entries(entries)) {
            if (v && Array.isArray(v.heatmap) && typeof v.ts === "number") {
              heatmapMemoryCache.set(k, {
                heatmap: v.heatmap,
                str: JSON.stringify(v.heatmap),
                ts: v.ts
              });
            }
          }
        }
      } catch (e) {}
    };

    const persistHeatmapCache = () => {
      const storageKey = getHeatmapStorageKey();
      if (!storageKey) return;
      try {
        const entries = {};
        // 最多保留最近 24 条 (platform:year) 组合，单条仅数 KB，轻量无压力
        const list = Array.from(heatmapMemoryCache.entries())
          .sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0))
          .slice(0, 24);
        for (const [k, v] of list) {
          entries[k] = { heatmap: v.heatmap, ts: v.ts };
        }
        localStorage.setItem(storageKey, JSON.stringify({
          available_years: availableHeatmapYears.value || [],
          entries
        }));
      } catch (e) {}
    };

    const getCachedHeatmapEntry = (platform, year) => {
      hydrateHeatmapCache();
      const entry = heatmapMemoryCache.get(`${platform}:${year}`);
      if (!entry) return null;
      const nowYear = new Date().getFullYear();
      const ttl = Number(year) < nowYear ? HEATMAP_PAST_YEAR_TTL_MS : HEATMAP_CURR_YEAR_TTL_MS;
      return {
        ...entry,
        fresh: (Date.now() - entry.ts) < ttl
      };
    };

    const setCachedHeatmapEntry = (platform, year, heatmap, incomingStr) => {
      hydrateHeatmapCache();
      heatmapMemoryCache.set(`${platform}:${year}`, {
        heatmap,
        str: incomingStr || JSON.stringify(heatmap),
        ts: Date.now()
      });
      persistHeatmapCache();
    };

    const cancelHeatmapPrefetch = () => {
      heatmapPrefetchGen++;
      if (heatmapPrefetchTimer) {
        clearTimeout(heatmapPrefetchTimer);
        heatmapPrefetchTimer = null;
      }
    };

    const invalidateHeatmapCache = (clearStorage = true) => {
      cancelHeatmapPrefetch();
      heatmapMemoryCache.clear();
      lastHeatmapDataStr = "";
      if (clearStorage) {
        const storageKey = getHeatmapStorageKey();
        if (storageKey) {
          try { localStorage.removeItem(storageKey); } catch (e) {}
        }
      }
    };

    const getYearDatesList = (year) => {
      let list = heatmapYearDatesCache.get(year);
      if (list) return list;
      list = [];
      const cursor = new Date(year, 0, 1);
      while (cursor.getFullYear() === year) {
        const mm = String(cursor.getMonth() + 1).padStart(2, "0");
        const dd = String(cursor.getDate()).padStart(2, "0");
        list.push(`${year}-${mm}-${dd}`);
        cursor.setDate(cursor.getDate() + 1);
      }
      heatmapYearDatesCache.set(year, list);
      return list;
    };

    const schedulePrefetchOtherYears = (platform) => {
      if (!isLoggedIn.value) return;
      const years = (availableHeatmapYears.value || []).filter(y => y !== selectedHeatmapYear.value);
      if (years.length === 0) return;
      const missingYears = years.filter(y => {
        const c = getCachedHeatmapEntry(platform, y);
        return !c || !c.fresh;
      });
      if (missingYears.length === 0) return;

      cancelHeatmapPrefetch();
      const gen = heatmapPrefetchGen;
      heatmapPrefetchTimer = setTimeout(() => {
        heatmapPrefetchTimer = null;
        const runPrefetch = async () => {
          for (const yr of missingYears) {
            if (gen !== heatmapPrefetchGen || !isLoggedIn.value || document.hidden) return;
            const existing = getCachedHeatmapEntry(platform, yr);
            if (existing && existing.fresh) continue;
            try {
              const res = await apiFetch(`/api/stats/heatmap?platform=${platform}&year=${yr}`);
              if (gen !== heatmapPrefetchGen) return;
              const data = await res.json();
              const incoming = data.heatmap || [];
              setCachedHeatmapEntry(platform, yr, incoming, JSON.stringify(incoming));
            } catch (e) {
              return;
            }
          }
        };
        if (typeof window.requestIdleCallback === "function") {
          window.requestIdleCallback(() => { runPrefetch(); }, { timeout: 2500 });
        } else {
          runPrefetch();
        }
      }, 650);
    };

    // --- 提交记录 5 页窗口分块懒加载缓存 (每块 5 页 = 150 条，滑动预取下一块，全量历史零截断) ---
    const SUBS_CHUNK_PAGES = 5;
    const SUBS_MAX_CACHED_CHUNKS = 12;
    const submissionsChunkCache = new Map(); // key: `${filterKey}::${chunkIdx}` -> { items, total, ts }
    let submissionsReqSeq = 0;
    let isResettingSubmissionFilters = false;

    const invalidateSubmissionsCache = () => {
      submissionsChunkCache.clear();
      submissionsReqSeq++;
    };

    // --- 纯事件驱动 SSE 实时推送连接状态（彻底取代 15 秒盲轮询，静止零 HTTP 轮询与零 SQL 负载） ---
    let eventSource = null;
    let sseReconnectTimer = null;
    let sseReconnectDelay = 3000;
    let lastUserRefreshTime = 0;
    let lastHiddenTimestamp = 0;
    const sseDomainTimers = new Map();

    const clearSseDomainTimers = () => {
      sseDomainTimers.forEach((t) => clearTimeout(t));
      sseDomainTimers.clear();
    };

    const disconnectEventStream = () => {
      if (sseReconnectTimer) {
        clearTimeout(sseReconnectTimer);
        sseReconnectTimer = null;
      }
      clearSseDomainTimers();
      if (eventSource) {
        try { eventSource.close(); } catch (e) {}
        eventSource = null;
      }
      sseReconnectDelay = 3000;
    };

    const resetAllUserStates = () => {
      // 1. 断开 SSE 事件流并清理定时器
      disconnectEventStream();
      invalidateSubmissionsCache();
      submissionsTotal.value = 0;

      // 2. 清理用户凭证与登录态
      token.value = "";
      localStorage.removeItem("oiboard_token");
      localStorage.removeItem("oiboard_user");
      currentUser.value = null;

      // 3. 清空业务响应式数据，杜绝跨用户数据残留
      overview.value = {
        stats: { total_ac: 0, total_subs: 0, today_ac: 0, today_ac_subs: 0, today_subs: 0, streak: 0, platforms: {} },
        platforms_status: [],
        last_sync_time: "",
        climbing_curve: [],
        daily_effort: [],
        local_code: { total_lines: 0, today_lines: 0, total_files: 0, today_files: 0, c_lines: 0, cpp_lines: 0, java_lines: 0, has_data: false }
      };
      rawHeatmap.value = [];
      submissions.value = [];
      mistakes.value = [];
      dueMistakesList.value = [];
      mistakeTotal.value = 0;
      mistakesCounts.value = { total: 0, due: 0, in_progress: 0, mastered: 0 };
      mistakeKeySet.value = new Set();
      tagStats.value = [];
      accounts.value = [];
      configs.value = {};
      platformStatusMap.value = {};
      contests.value = [];
      contestMetaMap.value = {};

      // 4. 重置所有缓存特征键与快照基准，确保切换账号重新登录后无条件强制重绘最新图表
      lastKnownTotalSubs = -1;
      lastKnownSyncTime = "";
      lastHeatmapDataStr = "";
      lastHeatmapRenderKey = "";
      lastHeatmapCanvasW = 0;
      lastHeatmapCanvasH = 0;
      cancelHeatmapPrefetch();
      heatmapMemoryCache.clear();
      heatmapCacheHydratedUid = null;
      lastClimbingKey = "";
      lastDailyKey = "";
      lastTagChartKey = "";
      lastPieKey = "";
      lastTagsHash = "";
      settingsBaseline = {
        poll_interval_minutes: "1440",
        http_proxy: "",
        sprint_mode: "false"
      };

      // 5. 清除图表渲染画布残留
      if (heatmapChart) {
        try { heatmapChart.clear(); } catch (e) {}
      }
      if (analyticsChart) {
        try { analyticsChart.clear(); } catch (e) {}
      }
    };

    // --- Apple Segmented Control 物理级滑动指示器同步引擎 ---
    const syncSegmentedThumbs = () => {
      nextTick(() => {
        const controls = document.querySelectorAll(".segmented-control");
        const updates = [];

        // 阶段 1：统一只读布局值 (Batch DOM Read)
        controls.forEach(ctrl => {
          let thumb = ctrl.querySelector(".segmented-thumb");
          if (!thumb) {
            thumb = document.createElement("div");
            thumb.className = "segmented-thumb";
            ctrl.insertBefore(thumb, ctrl.firstChild);
          }
          const active = ctrl.querySelector(".segmented-item.active");
          if (active && active.offsetParent !== null) {
            updates.push({
              thumb,
              visible: true,
              left: active.offsetLeft,
              width: active.offsetWidth,
              height: active.offsetHeight
            });
          } else {
            updates.push({
              thumb,
              visible: false
            });
          }
        });

        // 阶段 2：统一写入样式 (Batch DOM Write)，消除读写交替造成的强制同步重排 (Layout Thrashing)
        for (let i = 0; i < updates.length; i++) {
          const u = updates[i];
          if (u.visible) {
            u.thumb.style.transform = `translateX(${u.left}px)`;
            u.thumb.style.width = `${u.width}px`;
            u.thumb.style.height = `${u.height}px`;
            u.thumb.style.opacity = "1";
          } else {
            u.thumb.style.opacity = "0";
          }
        }
      });
    };

    // --- Theme Engine (Auto Day/Night, Light, Dark) ---
    const themePref = ref(localStorage.getItem("oiboard_theme_pref") || "auto");
    const isDark = ref(false);

    const isDaylightTime = () => {
      const h = new Date().getHours();
      return h >= 6 && h < 18; // 06:00 to 18:00 is Day (Light mode)
    };

    const computeEffectiveDark = () => {
      if (themePref.value === "light") return false;
      if (themePref.value === "dark") return true;
      return !isDaylightTime(); // auto mode: day = light, night = dark
    };

    const applyTheme = () => {
      const dark = computeEffectiveDark();
      isDark.value = dark;
      if (dark) {
        document.documentElement.classList.add("dark");
        document.body.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
        document.body.classList.remove("dark");
      }
      if (currentTab.value === "overview") {
        nextTick(() => {
          renderHeatmap(true);
          renderActiveChart(true);
        });
      }
      syncSegmentedThumbs();
    };

    const setThemePref = (mode) => {
      themePref.value = mode;
      localStorage.setItem("oiboard_theme_pref", mode);
      const doSwitch = () => {
        applyTheme();
        syncSegmentedThumbs();
      };
      if (typeof document.startViewTransition === "function" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        document.startViewTransition(doSwitch);
      } else {
        doSwitch();
      }
      const desc = mode === "auto"
        ? `自动 (${isDark.value ? '深色' : '浅色'})`
        : (mode === "dark" ? "深色" : "浅色");
      showToast(`外观: ${desc}`, "info");
    };

    // --- UI Scale Engine & High-DPI Adaptation ---
    const uiScalePref = ref(localStorage.getItem("oiboard_ui_scale") || "auto");

    // --- macOS 15 Frosted Glass & Layered Depth Switch ---
    const glassMode = ref((localStorage.getItem("oiboard_glass_mode") || "on") !== "off");

    const applyGlassMode = () => {
      document.documentElement.dataset.glass = glassMode.value ? "on" : "off";
    };

    const toggleGlassMode = () => {
      glassMode.value = !glassMode.value;
      localStorage.setItem("oiboard_glass_mode", glassMode.value ? "on" : "off");
      applyGlassMode();
      if (currentTab.value === "overview") {
        nextTick(() => {
          renderHeatmap(true);
          renderActiveChart(true);
        });
      }
      showToast(glassMode.value ? "已开启磨砂玻璃" : "已关闭磨砂玻璃", "info");
    };

    // 动态依据根元素实际 px 大小计算 ECharts 矢量字号，保证 2K/4K/大字号下文字清晰比例协调
    const getChartFontSize = (baseSize) => {
      try {
        const rootPx = parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
        const ratio = rootPx / 16;
        return Math.max(9, Math.round(baseSize * ratio));
      } catch (e) {
        return baseSize;
      }
    };

    const applyUiScale = () => {
      const scale = uiScalePref.value;
      if (!scale || scale === "auto") {
        delete document.documentElement.dataset.uiScale;
      } else {
        document.documentElement.dataset.uiScale = scale;
      }
      nextTick(() => {
        window.dispatchEvent(new Event("resize"));
        if (currentTab.value === "overview") {
          renderHeatmap(true);
          renderActiveChart(true);
        }
      });
    };

    const setUiScalePref = (scale) => {
      uiScalePref.value = scale;
      localStorage.setItem("oiboard_ui_scale", scale);
      applyUiScale();
      const labelMap = {
        'auto': '自动 (根据分辨率自适应)',
        '100': '100% (标准 1080P)',
        '115': '115% (舒适微调)',
        '125': '125% (2K QHD 推荐)',
        '140': '140% (3K 宽屏)',
        '150': '150% (4K UHD 推荐)'
      };
      showToast(`缩放: ${labelMap[scale] || (scale + '%')}`, "info");
    };

    // --- Toast 消息提示 ---
    let toastTimer = null;
    const showToast = (message, type = "success") => {
      if (toastTimer) clearTimeout(toastTimer);
      toast.value = { show: true, message, type };
      toastTimer = setTimeout(() => {
        toast.value.show = false;
        toastTimer = null;
      }, 3200);
    };

    // --- 安全统一 API 请求包装器 (彻底杜绝浏览器/CDN缓存 + 差异化请求超时熔断) ---
    const apiFetch = async (url, options = {}) => {
      options.headers = options.headers || {};
      options.headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
      options.headers["Pragma"] = "no-cache";
      options.headers["Expires"] = "0";
      options.cache = "no-store";
      if (token.value) {
        options.headers["Authorization"] = `Bearer ${token.value}`;
      }
      if (options.body && typeof options.body === "string" && !options.headers["Content-Type"]) {
        options.headers["Content-Type"] = "application/json";
      }
      
      // 为 GET 请求自动附加当前毫秒时间戳参数，强制浏览器向服务器请求最新数据
      let reqUrl = url;
      if (!options.method || options.method.toUpperCase() === "GET") {
        const sep = reqUrl.includes("?") ? "&" : "?";
        reqUrl = `${reqUrl}${sep}_t=${Date.now()}`;
      }

      // A6-1 / A7-3: 差异化超时控制：常规只读与轮询 20 秒，长时外部爬虫任务支持自定义更长超时 (如 120s~180s)
      const timeoutMs = typeof options.timeoutMs === "number" ? options.timeoutMs : 20000;
      let timeoutId = null;
      let controller = null;
      if (timeoutMs > 0) {
        controller = new AbortController();
        timeoutId = setTimeout(() => {
          controller.abort();
        }, timeoutMs);
        if (!options.signal) {
          options.signal = controller.signal;
        }
      }
      
      try {
        const res = await fetch(reqUrl, options);
        if (res.status === 401) {
          resetAllUserStates();
          authError.value = "登录会话已过期，请重新登录";
          fetchCaptcha();
          throw new Error("UNAUTHORIZED");
        }
        return res;
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      }
    };

    // --- Captcha Actions ---
    const fetchCaptcha = async () => {
      try {
        const res = await fetch("/api/auth/captcha?t=" + Date.now());
        if (res.ok) {
          const data = await res.json();
          captchaId.value = data.captcha_id;
          captchaImage.value = data.captcha_image;
        }
      } catch (e) {
        console.error("获取验证码异常:", e);
      }
    };

    // 切换登录/注册模式时，自动刷新验证码并隐藏密码明文
    watch(authMode, () => {
      authError.value = "";
      authForm.value.captcha_code = "";
      showAuthPwd.value = false;
      fetchCaptcha();
    });

    // --- Auth Actions ---
    const handleLogin = async () => {
      authError.value = "";
      if (!authForm.value.username.trim() || !authForm.value.password) {
        authError.value = "请完整填写用户名与密码";
        return;
      }
      if (!authForm.value.captcha_code || !authForm.value.captcha_code.trim()) {
        authError.value = "请输入图片验证码";
        return;
      }
      isAuthLoading.value = true;
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: authForm.value.username.trim(),
            password: authForm.value.password,
            captcha_id: captchaId.value,
            captcha_code: authForm.value.captcha_code.trim()
          })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          token.value = data.token;
          localStorage.setItem("oiboard_token", data.token);
          localStorage.setItem("oiboard_user", JSON.stringify(data.user));
          currentUser.value = data.user;
          isAuthChecking.value = false;
          showToast(`欢迎回来，${data.user.username}！`, "success");
          authForm.value = { username: "", password: "", confirmPassword: "", captcha_code: "" };
          showAuthPwd.value = false;
          await reloadAllData();
          triggerStartupNotification();
          connectEventStream();
        } else {
          authError.value = data.detail || data.message || "登录失败，请检查账号密码";
          authForm.value.captcha_code = "";
          await fetchCaptcha();
        }
      } catch (e) {
        if (e.message !== "UNAUTHORIZED") {
          authError.value = "网络请求失败: " + e.message;
          authForm.value.captcha_code = "";
          await fetchCaptcha();
        }
      } finally {
        isAuthLoading.value = false;
      }
    };

    const handleRegister = async () => {
      authError.value = "";
      const uname = authForm.value.username.trim();
      const pwd = authForm.value.password;
      const cpwd = authForm.value.confirmPassword;

      if (!uname || !pwd || !cpwd) {
        authError.value = "请完整填写注册信息";
        return;
      }
      if (uname.length < 3 || uname.length > 32) {
        authError.value = "用户名长度须在 3-32 位之间";
        return;
      }
      if (pwd.length < 6) {
        authError.value = "密码长度不能少于 6 位";
        return;
      }
      if (pwd !== cpwd) {
        authError.value = "两次输入的密码不一致";
        return;
      }
      if (!authForm.value.captcha_code || !authForm.value.captcha_code.trim()) {
        authError.value = "请输入图片验证码";
        return;
      }

      isAuthLoading.value = true;
      try {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: uname,
            password: pwd,
            captcha_id: captchaId.value,
            captcha_code: authForm.value.captcha_code.trim()
          })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          token.value = data.token;
          localStorage.setItem("oiboard_token", data.token);
          localStorage.setItem("oiboard_user", JSON.stringify(data.user));
          currentUser.value = data.user;
          isAuthChecking.value = false;
          showToast("账户注册成功！", "success");
          authForm.value = { username: "", password: "", confirmPassword: "", captcha_code: "" };
          showAuthPwd.value = false;
          await reloadAllData();
          triggerStartupNotification();
          connectEventStream();
        } else {
          authError.value = data.detail || data.message || "注册失败";
          authForm.value.captcha_code = "";
          await fetchCaptcha();
        }
      } catch (e) {
        if (e.message !== "UNAUTHORIZED") {
          authError.value = "网络请求异常: " + e.message;
          authForm.value.captcha_code = "";
          await fetchCaptcha();
        }
      } finally {
        isAuthLoading.value = false;
      }
    };

    const handleLogout = async () => {
      try {
        if (token.value) {
          await apiFetch("/api/auth/logout", { method: "POST" });
        }
      } catch (e) {
        // ignore
      } finally {
        resetAllUserStates();
        isAuthChecking.value = false;
        showToast("已成功退出登录", "success");
        fetchCaptcha();
      }
    };

    const handleChangePassword = async () => {
      if (!pwdForm.value.oldPassword || !pwdForm.value.newPassword) {
        showToast("请填写原密码与新密码", "error");
        return;
      }
      if (pwdForm.value.newPassword.length < 6) {
        showToast("新密码长度不能少于 6 位", "error");
        return;
      }
      if (pwdForm.value.newPassword !== pwdForm.value.confirmNewPassword) {
        showToast("两次输入的新密码不一致", "error");
        return;
      }

      isChangingPwd.value = true;
      try {
        const res = await apiFetch("/api/auth/password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            old_password: pwdForm.value.oldPassword,
            new_password: pwdForm.value.newPassword
          })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          showToast("密码修改成功！请重新登录", "success");
          pwdForm.value = { oldPassword: "", newPassword: "", confirmNewPassword: "" };
          setTimeout(() => {
            handleLogout();
          }, 1500);
        } else {
          showToast(data.detail || data.message || "修改密码失败", "error");
        }
      } catch (e) {
        showToast("请求失败: " + e.message, "error");
      } finally {
        isChangingPwd.value = false;
      }
    };

    // --- Local Agent Token Helper ---
    const isTokenCopied = ref(false);
    const copySyncToken = () => {
      const tok = token.value || "";
      if (!tok) {
        showToast("暂无可用的登录 Token", "error");
        return;
      }
      navigator.clipboard.writeText(tok).then(() => {
        isTokenCopied.value = true;
        showToast("Token 已复制", "success");
        setTimeout(() => {
          isTokenCopied.value = false;
        }, 3000);
      }).catch(() => {
        showToast("复制失败", "error");
      });
    };

    // --- Submissions Filter & 5-Page Windowed Chunk Pagination ---
    const availableTags = computed(() => {
      return (tagStats.value || []).map(t => t.tag).filter(Boolean).sort();
    });

    const getSubmissionFilterParams = () => {
      let sDate = "";
      let eDate = "";
      if (dateFilter.value !== "all") {
        const todayStr = getLocalDateStr(0);
        if (dateFilter.value === "today") {
          sDate = todayStr;
          eDate = todayStr;
        } else if (dateFilter.value === "7d") {
          sDate = getLocalDateStr(-7);
        } else if (dateFilter.value === "30d") {
          sDate = getLocalDateStr(-30);
        } else if (dateFilter.value === "year") {
          sDate = `${new Date().getFullYear()}-01-01`;
        } else if (dateFilter.value === "custom") {
          sDate = startDate.value || "";
          eDate = endDate.value || "";
        }
      }
      return {
        platform: subFilter.value || "all",
        verdict: verdictFilter.value || "all",
        tag: selectedTag.value || "",
        start_date: sDate,
        end_date: eDate,
        search: (debouncedSearchKeyword.value || "").trim()
      };
    };

    const totalPages = computed(() => {
      return Math.max(1, Math.ceil((submissionsTotal.value || 0) / pageSize.value));
    });

    const paginatedSubmissions = computed(() => submissions.value || []);

    const setDateFilter = (preset) => {
      dateFilter.value = preset;
      currentPage.value = 1;
      nextTick(syncSegmentedThumbs);
    };

    const resetFilters = async () => {
      isResettingSubmissionFilters = true;
      dateFilter.value = "all";
      startDate.value = "";
      endDate.value = "";
      subFilter.value = "all";
      verdictFilter.value = "all";
      selectedTag.value = "";
      searchKeyword.value = "";
      debouncedSearchKeyword.value = "";
      currentPage.value = 1;
      await nextTick();
      isResettingSubmissionFilters = false;
      syncSegmentedThumbs();
      if (currentTab.value === "submissions") {
        loadSubmissions({ page: 1 });
      }
    };

    // 筛选条件变化时回到第 1 页并按 5 页分块按需拉取
    watch([subFilter, verdictFilter, selectedTag, dateFilter, startDate, endDate, debouncedSearchKeyword], () => {
      if (isResettingSubmissionFilters) return;
      const needResetPage = currentPage.value !== 1;
      currentPage.value = 1;
      if (currentTab.value === "submissions" && !needResetPage) {
        loadSubmissions({ page: 1 });
      }
    });

    watch(currentPage, (p) => {
      if (isResettingSubmissionFilters) return;
      if (currentTab.value === "submissions") {
        loadSubmissions({ page: p });
      }
    });

    // --- Contest Computed & Helpers (A5: 集中秒级计算并以 O(1) 字典缓存，消除模板中多卡片重复函数调用) ---
    const updateContestMetas = () => {
      const now = Math.floor(Date.now() / 1000);
      nowTimestamp.value = now;
      const list = contests.value || [];
      const map = {};
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        const st = c.start_timestamp;
        const dur = c.duration_seconds || 7200;
        const et = st + dur;
        let status = "FINISHED";
        let countdown = "已结束";

        if (now < st) {
          status = "BEFORE";
          const diff = st - now;
          const days = Math.floor(diff / 86400);
          const hours = Math.floor((diff % 86400) / 3600);
          const mins = Math.floor((diff % 3600) / 60);
          if (days > 0) {
            countdown = `还有 ${days} 天 ${hours} 小时 ${mins} 分`;
          } else if (hours > 0) {
            countdown = `还有 ${hours} 小时 ${mins} 分`;
          } else if (mins > 0) {
            countdown = `还有 ${mins} 分`;
          } else {
            countdown = "即将开始";
          }
        } else if (now < et) {
          status = "CODING";
          const remaining = et - now;
          const hours = Math.floor(remaining / 3600);
          const mins = Math.floor((remaining % 3600) / 60);
          if (hours > 0) {
            countdown = `进行中 (剩 ${hours}小时${mins}分)`;
          } else if (mins > 0) {
            countdown = `进行中 (剩 ${mins}分)`;
          } else {
            countdown = "进行中 (即将结束)";
          }
        }
        map[c.id] = { status, countdown };
      }
      contestMetaMap.value = map;
    };

    const getContestStatus = (c) => {
      if (contestMetaMap.value[c.id]) {
        return contestMetaMap.value[c.id].status;
      }
      const now = nowTimestamp.value;
      const st = c.start_timestamp;
      const dur = c.duration_seconds || 7200;
      return (now < st) ? "BEFORE" : (now < st + dur ? "CODING" : "FINISHED");
    };

    const computeContestCountdown = (c) => {
      const now = nowTimestamp.value || Math.floor(Date.now() / 1000);
      const st = c.start_timestamp;
      const dur = c.duration_seconds || 7200;
      const et = st + dur;
      if (now < st) {
        const diff = st - now;
        const days = Math.floor(diff / 86400);
        const hours = Math.floor((diff % 86400) / 3600);
        const mins = Math.floor((diff % 3600) / 60);
        if (days > 0) return `还有 ${days} 天 ${hours} 小时 ${mins} 分`;
        if (hours > 0) return `还有 ${hours} 小时 ${mins} 分`;
        if (mins > 0) return `还有 ${mins} 分`;
        return "即将开始";
      } else if (now < et) {
        const remaining = et - now;
        const hours = Math.floor(remaining / 3600);
        const mins = Math.floor((remaining % 3600) / 60);
        if (hours > 0) return `进行中 (剩 ${hours}小时${mins}分)`;
        if (mins > 0) return `进行中 (剩 ${mins}分)`;
        return "进行中 (即将结束)";
      }
      return "已结束";
    };

    const formatContestCountdown = (c) => {
      if (contestMetaMap.value && contestMetaMap.value[c.id]) {
        return contestMetaMap.value[c.id].countdown;
      }
      return computeContestCountdown(c);
    };

    const filteredContests = computed(() => {
      let list = contests.value || [];
      if (contestFilter.value !== "all") {
        list = list.filter(c => c.platform === contestFilter.value);
      }
      if (contestStatusFilter.value !== "all") {
        list = list.filter(c => getContestStatus(c) === contestStatusFilter.value);
      }
      if (contestSearch.value.trim()) {
        const kw = contestSearch.value.trim().toLowerCase();
        list = list.filter(c => 
          (c.name || "").toLowerCase().includes(kw) || 
          (c.rule_type || "").toLowerCase().includes(kw) || 
          (c.platform || "").toLowerCase().includes(kw)
        );
      }
      return list;
    });

    const upcomingContestsCount = computed(() => {
      const now = nowTimestamp.value;
      return (contests.value || []).filter(c => (c.start_timestamp + (c.duration_seconds || 7200)) > now).length;
    });

    const topUpcomingContests = computed(() => {
      const now = nowTimestamp.value;
      return (contests.value || [])
        .filter(c => (c.start_timestamp + (c.duration_seconds || 7200)) > now)
        .slice(0, 3);
    });

    const todayAcRate = computed(() => {
      const subs = overview.value.stats?.today_subs || 0;
      const acSubs = overview.value.stats?.today_ac_subs ?? overview.value.stats?.today_ac ?? 0;
      if (subs <= 0) return 0;
      return Math.min(100, Math.round((acSubs / subs) * 100));
    });

    // --- Data Loaders (绑定当前用户) ---
    const loadOverview = async ({ throwOnError = false } = {}) => {
      try {
        const res = await apiFetch("/api/stats/overview");
        const data = await res.json();
        if (data && data.stats) {
          const newTotal = data.stats.total_subs || 0;
          const newSync = data.last_sync_time || "";
          const prevTotal = lastKnownTotalSubs;
          const prevSync = lastKnownSyncTime;

          overview.value = {
            stats: {
              total_ac: data.stats.total_ac || 0,
              total_subs: data.stats.total_subs || 0,
              today_ac: data.stats.today_ac || 0,
              today_ac_subs: data.stats.today_ac_subs ?? data.stats.today_ac ?? 0,
              today_subs: data.stats.today_subs || 0,
              streak: data.stats.streak || 0,
              platforms: data.stats.platforms || {}
            },
            platforms_status: data.platforms_status || [],
            last_sync_time: newSync || overview.value.last_sync_time || "",
            climbing_curve: data.climbing_curve || [],
            daily_effort: data.daily_effort || [],
            local_code: (() => {
              const lc = data.local_code || { total_lines: 0, today_lines: 0, total_files: 0, today_files: 0, c_lines: 0, cpp_lines: 0, java_lines: 0, has_data: false };
              if (lc.synced_at) {
                // 北京时间 (Asia/Shanghai) YYYY-MM-DD
                const beijingDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
                if (!lc.synced_at.startsWith(beijingDate)) {
                  lc.today_lines = 0;
                  lc.today_files = 0;
                }
              }
              return lc;
            })()
          };

          if (currentTab.value === "overview") {
            nextTick(() => {
              renderActiveChart();
            });
          }

          if (lastKnownTotalSubs !== -1 && newTotal !== lastKnownTotalSubs) {
            invalidateHeatmapCache(true);
            invalidateSubmissionsCache();
          }
          lastKnownTotalSubs = newTotal;
          lastKnownSyncTime = newSync;
          // 移除原有的内部联动调用 loadHeatmap()，统一由调度器在周期内发起，彻底杜绝重复请求
        }

        if (data.platforms_status && Array.isArray(data.platforms_status)) {
          const newStatusMap = { ...platformStatusMap.value };
          data.platforms_status.forEach(p => {
            newStatusMap[p.platform] = p;
          });
          platformStatusMap.value = newStatusMap;
        }
        
        let hasWarning = false;
        (data.platforms_status || []).forEach(p => {
          if (p.status === "error" || p.status === "warning") {
            hasWarning = true;
          }
        });
        if (hasWarning) {
          warningBanner.value = "部分平台连接异常";
        } else {
          warningBanner.value = "";
        }
      } catch (e) {
        console.error("加载 Overview 失败:", e);
        if (throwOnError) throw e;
      }
    };

    const loadHeatmap = async ({ throwOnError = false, useCacheFirst = true, forceNetwork = false } = {}) => {
      const targetPlatform = heatmapFilter.value;
      const targetYear = selectedHeatmapYear.value || new Date().getFullYear();
      const reqSeq = ++heatmapRequestSeq;

      // 1. 优先命中本地缓存，零延迟直接上屏
      const cached = useCacheFirst ? getCachedHeatmapEntry(targetPlatform, targetYear) : null;
      if (cached) {
        const cachedChanged = cached.str !== lastHeatmapDataStr;
        if (cachedChanged || rawHeatmap.value !== cached.heatmap) {
          lastHeatmapDataStr = cached.str;
          rawHeatmap.value = cached.heatmap;
        }
        if (currentTab.value === "overview") {
          renderHeatmap(false);
        }
        // 缓存仍在有效期内且未强制刷新：跳过网络请求，直接返回
        if (cached.fresh && !forceNetwork) {
          schedulePrefetchOtherYears(targetPlatform);
          return;
        }
      }

      // 2. 拉取服务端最新数据（带防竞态序列校验，快速连续切换年份不会串数据）
      try {
        const res = await apiFetch(`/api/stats/heatmap?platform=${targetPlatform}&year=${targetYear}`);
        const data = await res.json();
        const incomingHeatmap = data.heatmap || [];
        const incomingStr = JSON.stringify(incomingHeatmap);
        const resolvedYear = data.year || targetYear;

        if (data.available_years && data.available_years.length > 0) {
          availableHeatmapYears.value = data.available_years;
        }
        setCachedHeatmapEntry(targetPlatform, resolvedYear, incomingHeatmap, incomingStr);

        // 若请求返回期间用户已切换到其他年份或平台，仅写入缓存，不覆盖当前画面
        if (reqSeq !== heatmapRequestSeq || heatmapFilter.value !== targetPlatform || selectedHeatmapYear.value !== resolvedYear) {
          return;
        }

        const dataChanged = incomingStr !== lastHeatmapDataStr;
        if (dataChanged) {
          lastHeatmapDataStr = incomingStr;
          rawHeatmap.value = incomingHeatmap;
        }
        if (data.year && selectedHeatmapYear.value !== data.year) {
          selectedHeatmapYear.value = data.year;
        }
        if (currentTab.value === "overview") {
          await nextTick();
          renderHeatmap(false);
        }
        schedulePrefetchOtherYears(targetPlatform);
      } catch (e) {
        console.error("加载 Heatmap 失败:", e);
        if (throwOnError) throw e;
      }
    };

    const loadTags = async ({ throwOnError = false } = {}) => {
      try {
        const res = await apiFetch("/api/stats/tags");
        const data = await res.json();
        const incomingTags = data.tags || [];
        const incomingHash = JSON.stringify(incomingTags);
        if (incomingHash !== lastTagsHash) {
          lastTagsHash = incomingHash;
          tagStats.value = incomingTags;
          if (chartView.value === "tags" && currentTab.value === "overview") {
            renderTagBarChart();
          }
        }
      } catch (e) {
        console.error("加载 Tag 统计失败:", e);
        if (throwOnError) throw e;
      }
    };

    const loadMistakeKeys = async ({ throwOnError = false } = {}) => {
      try {
        const res = await apiFetch("/api/mistakes/keys");
        const data = await res.json();
        mistakeKeySet.value = new Set(data.keys || []);
      } catch (e) {
        console.error("加载已收录错题Key失败:", e);
        if (throwOnError) throw e;
      }
    };

    const loadDueMistakes = async () => {
      try {
        const res = await apiFetch("/api/mistakes?status=due&page=1&page_size=50");
        const data = await res.json();
        dueMistakesList.value = data.items || [];
        if (data.counts) {
          mistakesCounts.value = data.counts;
        }
      } catch (e) {
        console.error("加载待复习错题失败:", e);
      }
    };

    const loadMistakes = async ({ throwOnError = false } = {}) => {
      isMistakesLoading.value = true;
      try {
        const params = new URLSearchParams({
          status: mistakeStatusFilter.value,
          platform: mistakePlatformFilter.value,
          search: mistakeSearch.value,
          tag: mistakeTagFilter.value,
          sort_by: mistakeSortBy.value,
          page: String(mistakePage.value),
          page_size: String(mistakePageSize.value)
        });
        const res = await apiFetch(`/api/mistakes?${params.toString()}`);
        const data = await res.json();
        mistakes.value = data.items || [];
        mistakeTotal.value = data.total || 0;
        if (data.counts) {
          mistakesCounts.value = data.counts;
        }
      } catch (e) {
        console.error("加载错题集失败:", e);
        if (throwOnError) throw e;
      } finally {
        isMistakesLoading.value = false;
      }
    };

    let mistakeSearchDebounceTimer = null;
    let isResettingMistakeFilters = false;

    const resetMistakeFilters = async () => {
      isResettingMistakeFilters = true;
      if (mistakeSearchDebounceTimer) {
        clearTimeout(mistakeSearchDebounceTimer);
        mistakeSearchDebounceTimer = null;
      }
      mistakeStatusFilter.value = "all";
      mistakePlatformFilter.value = "all";
      mistakeSearch.value = "";
      mistakeTagFilter.value = "";
      mistakePage.value = 1;
      await nextTick();
      isResettingMistakeFilters = false;
      syncSegmentedThumbs();
      await loadMistakes();
    };

    const handleSubmissionMistakeClick = async (sub) => {
      if (!sub) return;
      const key = `${sub.platform}:${sub.problem_id}`;
      if (mistakeKeySet.value.has(key)) {
        let existing = (mistakes.value || []).find(
          m => m.platform === sub.platform && String(m.problem_id) === String(sub.problem_id)
        );
        if (!existing) {
          try {
            const params = new URLSearchParams({
              status: "all",
              platform: sub.platform || "",
              search: String(sub.problem_id || ""),
              page: "1",
              page_size: "20"
            });
            const res = await apiFetch(`/api/mistakes?${params.toString()}`);
            const data = await res.json();
            existing = (data.items || []).find(
              m => m.platform === sub.platform && String(m.problem_id) === String(sub.problem_id)
            );
          } catch (e) {}
        }
        if (existing) {
          openAddToMistakesModal(existing, true);
          return;
        }
      }
      openAddToMistakesModal(sub, false);
    };

    const openAddToMistakesModal = (subOrItem, fromMistakesList = false) => {
      isMistakeEditing.value = fromMistakesList;
      mistakeFormTab.value = window.innerWidth >= 900 ? "split" : "write";
      subOrItem = subOrItem || {};
      
      let tagsStr = "";
      if (Array.isArray(subOrItem.tags)) {
        tagsStr = subOrItem.tags.join(", ");
      } else if (typeof subOrItem.tags === "string") {
        try {
          const parsed = JSON.parse(subOrItem.tags);
          if (Array.isArray(parsed)) {
            tagsStr = parsed.join(", ");
          } else {
            tagsStr = subOrItem.tags;
          }
        } catch {
          tagsStr = subOrItem.tags;
        }
      }

      mistakeForm.value = {
        id: fromMistakesList ? subOrItem.id : null,
        platform: subOrItem.platform || "luogu",
        problem_id: subOrItem.problem_id != null ? String(subOrItem.problem_id) : "",
        problem_title: subOrItem.problem_title != null ? String(subOrItem.problem_title) : "",
        difficulty: subOrItem.difficulty != null ? String(subOrItem.difficulty) : "",
        tags_input: tagsStr,
        key_point: subOrItem.key_point || "",
        notes: subOrItem.notes || "",
        problem_url: subOrItem.problem_url || subOrItem.submission_url || "",
        last_submitted_at: subOrItem.last_submitted_at || subOrItem.submitted_at || "",
        last_submission_id: subOrItem.last_submission_id != null ? String(subOrItem.last_submission_id) : (subOrItem.id != null ? String(subOrItem.id) : "")
      };
      mistakeModalOpen.value = true;
    };

    const saveMistake = async () => {
      if (!mistakeForm.value.problem_id || !mistakeForm.value.problem_title) {
        showToast("请填写题号和题目名称", "error");
        return;
      }
      isMistakeSaving.value = true;
      try {
        const tags = mistakeForm.value.tags_input
          ? mistakeForm.value.tags_input.split(/[,，]/).map(t => t.trim()).filter(Boolean)
          : [];

        if (isMistakeEditing.value && mistakeForm.value.id) {
          const res = await apiFetch(`/api/mistakes/${mistakeForm.value.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              problem_title: String(mistakeForm.value.problem_title || "").trim(),
              difficulty: mistakeForm.value.difficulty != null ? String(mistakeForm.value.difficulty).trim() : "",
              key_point: mistakeForm.value.key_point,
              notes: mistakeForm.value.notes,
              tags: tags,
              problem_url: mistakeForm.value.problem_url
            })
          });
          if (res.ok) {
            showToast("已更新错题笔记", "success");
            mistakeModalOpen.value = false;
            await loadMistakes();
            await loadDueMistakes();
            await loadMistakeKeys();
          } else {
            const err = await res.json().catch(() => ({}));
            const msg = typeof err.detail === "string" ? err.detail : (Array.isArray(err.detail) && err.detail[0]?.msg ? err.detail[0].msg : "更新失败，请重试");
            showToast(msg, "error");
          }
        } else {
          const res = await apiFetch("/api/mistakes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              platform: String(mistakeForm.value.platform || "luogu"),
              problem_id: String(mistakeForm.value.problem_id || "").trim(),
              problem_title: String(mistakeForm.value.problem_title || "").trim(),
              difficulty: mistakeForm.value.difficulty != null ? String(mistakeForm.value.difficulty) : "",
              tags: tags,
              key_point: mistakeForm.value.key_point || "",
              notes: mistakeForm.value.notes || "",
              problem_url: mistakeForm.value.problem_url || "",
              last_submitted_at: mistakeForm.value.last_submitted_at || "",
              last_submission_id: mistakeForm.value.last_submission_id != null ? String(mistakeForm.value.last_submission_id) : ""
            })
          });
          if (res.ok) {
            showToast("已加入错题集", "success");
            mistakeModalOpen.value = false;
            await loadMistakes();
            await loadDueMistakes();
            await loadMistakeKeys();
          } else {
            const err = await res.json().catch(() => ({}));
            const msg = typeof err.detail === "string" ? err.detail : (Array.isArray(err.detail) && err.detail[0]?.msg ? err.detail[0].msg : "收录失败，请重试");
            showToast(msg, "error");
          }
        }
      } catch (e) {
        console.error("保存错题失败:", e);
        showToast("保存失败: " + e.message, "error");
      } finally {
        isMistakeSaving.value = false;
      }
    };

    const deleteMistakeItem = async (item) => {
      if (!confirm(`移除错题 [${item.problem_id}] ${item.problem_title}？`)) {
        return;
      }
      try {
        const res = await apiFetch(`/api/mistakes/${item.id}`, { method: "DELETE" });
        if (res.ok) {
          showToast("已移除", "success");
          await loadMistakes();
          await loadDueMistakes();
          await loadMistakeKeys();
        } else {
          showToast("移除失败", "error");
        }
      } catch (e) {
        console.error("删除错题失败:", e);
        showToast("移除失败: " + e.message, "error");
      }
    };

    const recordMistakeReview = async (item) => {
      try {
        const res = await apiFetch(`/api/mistakes/${item.id}/review`, { method: "POST" });
        if (res.ok) {
          const data = await res.json();
          if (data.mistake.status === "mastered") {
            showToast("已掌握", "success");
          } else {
            showToast(`已补刷，下次 ${data.mistake.next_review_at}`, "success");
          }
          await loadMistakes();
          await loadDueMistakes();
          if (activeMistake.value && activeMistake.value.id === item.id) {
            activeMistake.value = data.mistake;
          }
        } else {
          showToast("记录失败", "error");
        }
      } catch (e) {
        console.error("记录复习失败:", e);
        showToast("记录失败: " + e.message, "error");
      }
    };

    const toggleMistakeMaster = async (item) => {
      try {
        const res = await apiFetch(`/api/mistakes/${item.id}/toggle-master`, { method: "POST" });
        if (res.ok) {
          const data = await res.json();
          showToast(data.mistake.status === "mastered" ? "已掌握" : "已恢复补刷", "success");
          await loadMistakes();
          await loadDueMistakes();
          if (activeMistake.value && activeMistake.value.id === item.id) {
            activeMistake.value = data.mistake;
          }
        }
      } catch (e) {
        console.error("切换掌握状态失败:", e);
      }
    };

    const copyPlainText = async (text) => {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(text);
        return;
      }
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    };

    const enhanceCodeBlocks = (containerSelector) => {
      const root = document.querySelector(containerSelector);
      if (!root) return;
      root.querySelectorAll("pre").forEach((preEl) => {
        if (preEl.closest(".md-code-wrap") || preEl.dataset.enhanced === "1") return;
        const codeEl = preEl.querySelector("code");
        if (!codeEl) return;
        preEl.dataset.enhanced = "1";

        if (window.hljs && !codeEl.classList.contains("hljs")) {
          try { window.hljs.highlightElement(codeEl); } catch (e) {}
        }

        const langMatch = (codeEl.className || "").match(/language-([a-zA-Z0-9_+-]+)/);
        const langLabel = langMatch ? langMatch[1].toUpperCase() : "CODE";
        const rawCode = codeEl.textContent || "";

        const wrap = document.createElement("div");
        wrap.className = "md-code-wrap";

        const header = document.createElement("div");
        header.className = "md-code-header";

        const left = document.createElement("div");
        left.className = "md-code-header-left";
        const dots = document.createElement("span");
        dots.className = "md-code-dots";
        dots.innerHTML = "<span></span><span></span><span></span>";
        const langSpan = document.createElement("span");
        langSpan.className = "md-code-lang";
        langSpan.textContent = langLabel;
        left.appendChild(dots);
        left.appendChild(langSpan);

        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "md-code-copy-btn";
        copyBtn.textContent = "复制";
        copyBtn.addEventListener("click", async () => {
          try {
            await copyPlainText(rawCode);
            copyBtn.textContent = "已复制 ✓";
            copyBtn.classList.add("is-copied");
            setTimeout(() => {
              copyBtn.textContent = "复制";
              copyBtn.classList.remove("is-copied");
            }, 1600);
          } catch (e) {
            showToast("复制失败", "error");
          }
        });

        header.appendChild(left);
        header.appendChild(copyBtn);

        const parent = preEl.parentNode;
        if (parent) {
          parent.insertBefore(wrap, preEl);
          wrap.appendChild(header);
          wrap.appendChild(preEl);
        }
      });
    };

    const openViewNoteModal = (item) => {
      activeMistake.value = item;
      viewNoteModalOpen.value = true;
      nextTick(() => {
        enhanceCodeBlocks("#mistake-markdown-content");
      });
    };

    const mistakeNotesStats = computed(() => {
      const text = mistakeForm.value?.notes || "";
      return {
        lines: text ? text.split(/\r?\n/).length : 0,
        chars: text.length
      };
    });

    const replaceEditorRange = (beforeText, afterText, defaultInner = "", cursorOffset = null) => {
      const ta = document.getElementById("mistake-notes-textarea");
      const current = mistakeForm.value.notes || "";
      if (!ta) {
        mistakeForm.value.notes = current + beforeText + defaultInner + afterText;
        return;
      }
      const start = ta.selectionStart ?? current.length;
      const end = ta.selectionEnd ?? start;
      const selected = current.slice(start, end) || defaultInner;
      const updated = current.slice(0, start) + beforeText + selected + afterText + current.slice(end);
      mistakeForm.value.notes = updated;
      const targetPos = cursorOffset !== null
        ? start + cursorOffset
        : start + beforeText.length + selected.length;
      nextTick(() => {
        const el = document.getElementById("mistake-notes-textarea");
        if (el) {
          el.focus();
          el.setSelectionRange(targetPos, targetPos);
        }
      });
    };

    const insertMdSyntax = (action) => {
      switch (action) {
        case "h2":
          replaceEditorRange("\n## ", "\n", "核心思路");
          break;
        case "h3":
          replaceEditorRange("\n### ", "\n", "关键细节");
          break;
        case "bold":
          replaceEditorRange("**", "**", "重点");
          break;
        case "inlineCode":
          replaceEditorRange("`", "`", "code");
          break;
        case "cpp":
          replaceEditorRange("\n```cpp\n", "\n```\n", "// 在此粘贴 AC 代码");
          break;
        case "python":
          replaceEditorRange("\n```python\n", "\n```\n", "# 在此粘贴 Python 代码");
          break;
        case "quote":
          replaceEditorRange("\n> ", "\n", "边界条件或关键结论");
          break;
        case "checklist":
          replaceEditorRange("\n- [ ] ", "\n", "需要复查的边界");
          break;
        case "complexity":
          replaceEditorRange("\n> **复杂度**：时间 `O(N log N)` · 空间 `O(N)`\n", "");
          break;
      }
    };

    const insertOiTemplate = () => {
      const scaffold = "## 核心思路\n\n\n## 复杂度分析\n- 时间复杂度：`O(...)`\n- 空间复杂度：`O(...)`\n\n## 易错点与边界\n- [ ] \n\n## AC 代码\n```cpp\n\n```\n";
      const cur = (mistakeForm.value.notes || "").trim();
      mistakeForm.value.notes = cur ? `${mistakeForm.value.notes.trimEnd()}\n\n---\n\n${scaffold}` : scaffold;
      nextTick(() => {
        const el = document.getElementById("mistake-notes-textarea");
        if (el) {
          el.focus();
          const pos = (mistakeForm.value.notes || "").indexOf("## 核心思路") + 8;
          el.setSelectionRange(pos, pos);
        }
      });
    };

    const handleMdKeydown = (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const ta = e.target;
        const val = mistakeForm.value.notes || "";
        const start = ta.selectionStart ?? 0;
        const end = ta.selectionEnd ?? start;
        if (e.shiftKey) {
          const lineStart = val.lastIndexOf("\n", start - 1) + 1;
          if (val.slice(lineStart, lineStart + 2) === "  ") {
            mistakeForm.value.notes = val.slice(0, lineStart) + val.slice(lineStart + 2);
            nextTick(() => ta.setSelectionRange(Math.max(lineStart, start - 2), Math.max(lineStart, end - 2)));
          }
        } else {
          mistakeForm.value.notes = val.slice(0, start) + "  " + val.slice(end);
          nextTick(() => ta.setSelectionRange(start + 2, start + 2));
        }
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        const k = e.key.toLowerCase();
        if (k === "b") {
          e.preventDefault();
          insertMdSyntax("bold");
        } else if (k === "e") {
          e.preventDefault();
          insertMdSyntax("inlineCode");
        } else if (k === "k") {
          e.preventDefault();
          replaceEditorRange("[", "](https://)", "链接文本");
        }
      }
    };

    const renderMarkdown = (content) => {
      if (!content || !content.trim()) {
        return "<p class='text-[var(--text-muted)] text-xs italic'>暂无笔记</p>";
      }
      if (window.marked) {
        try {
          return window.marked.parse(content);
        } catch (e) {
          return `<pre class='p-3 bg-black/5 dark:bg-white/5 rounded-xl font-mono text-xs overflow-x-auto'>${content}</pre>`;
        }
      }
      return `<pre class='p-3 bg-black/5 dark:bg-white/5 rounded-xl font-mono text-xs overflow-x-auto'>${content}</pre>`;
    };

    const putSubmissionChunkCache = (cacheKey, entry) => {
      if (submissionsChunkCache.has(cacheKey)) {
        submissionsChunkCache.delete(cacheKey);
      }
      submissionsChunkCache.set(cacheKey, entry);
      while (submissionsChunkCache.size > SUBS_MAX_CACHED_CHUNKS) {
        const oldestKey = submissionsChunkCache.keys().next().value;
        submissionsChunkCache.delete(oldestKey);
      }
    };

    const fetchSubmissionChunk = async (filterParams, filterKey, chunkIdx) => {
      const chunkSize = SUBS_CHUNK_PAGES * pageSize.value;
      const offset = chunkIdx * chunkSize;
      const qs = new URLSearchParams({
        paged: "1",
        offset: String(offset),
        limit: String(chunkSize),
        platform: filterParams.platform,
        verdict: filterParams.verdict,
        tag: filterParams.tag,
        start_date: filterParams.start_date,
        end_date: filterParams.end_date,
        search: filterParams.search
      });
      const res = await apiFetch(`/api/stats/submissions?${qs.toString()}`);
      const data = await res.json();
      const entry = {
        items: data.submissions || [],
        total: typeof data.total === "number" ? data.total : (data.submissions || []).length,
        ts: Date.now()
      };
      putSubmissionChunkCache(`${filterKey}::${chunkIdx}`, entry);
      return entry;
    };

    const prefetchAdjacentSubmissionChunk = (filterParams, filterKey, page, total) => {
      const pSize = pageSize.value;
      const chunkSize = SUBS_CHUNK_PAGES * pSize;
      const chunkIdx = Math.floor((page - 1) / SUBS_CHUNK_PAGES);
      const posInChunk = (page - 1) % SUBS_CHUNK_PAGES;

      // 翻到当前 5 页窗口的第 4/5 页时，静默预取下一窗口（后 5 页），保证跨块翻页零感知
      if (posInChunk >= SUBS_CHUNK_PAGES - 2 && (chunkIdx + 1) * chunkSize < total) {
        const nextKey = `${filterKey}::${chunkIdx + 1}`;
        if (!submissionsChunkCache.has(nextKey)) {
          fetchSubmissionChunk(filterParams, filterKey, chunkIdx + 1).catch(() => {});
        }
      }
      // 翻回窗口第 1 页且前面还有窗口时，静默预取上一窗口
      if (posInChunk === 0 && chunkIdx > 0) {
        const prevKey = `${filterKey}::${chunkIdx - 1}`;
        if (!submissionsChunkCache.has(prevKey)) {
          fetchSubmissionChunk(filterParams, filterKey, chunkIdx - 1).catch(() => {});
        }
      }
    };

    const loadSubmissions = async ({ throwOnError = false, page = null, forceRefresh = false } = {}) => {
      const targetPage = Math.max(1, page !== null ? page : currentPage.value);
      const filterParams = getSubmissionFilterParams();
      const filterKey = JSON.stringify(filterParams);
      const chunkIdx = Math.floor((targetPage - 1) / SUBS_CHUNK_PAGES);
      const posInChunk = (targetPage - 1) % SUBS_CHUNK_PAGES;
      const cacheKey = `${filterKey}::${chunkIdx}`;

      if (forceRefresh) {
        invalidateSubmissionsCache();
      }

      const reqSeq = ++submissionsReqSeq;

      // 1. 命中 5 页本地块缓存：0ms 立即切片渲染并按需滑动预取相邻 5 页
      const cached = !forceRefresh ? submissionsChunkCache.get(cacheKey) : null;
      if (cached) {
        const start = posInChunk * pageSize.value;
        submissionsTotal.value = cached.total;
        submissions.value = cached.items.slice(start, start + pageSize.value);
        prefetchAdjacentSubmissionChunk(filterParams, filterKey, targetPage, cached.total);
        return;
      }

      // 2. 未命中则仅向服务端请求当前 5 页窗口（150 条）
      isSubmissionsLoading.value = true;
      try {
        const entry = await fetchSubmissionChunk(filterParams, filterKey, chunkIdx);
        if (reqSeq !== submissionsReqSeq) return;
        const maxPage = Math.max(1, Math.ceil(entry.total / pageSize.value));
        if (targetPage > maxPage && maxPage < targetPage) {
          currentPage.value = maxPage;
          return;
        }
        const start = posInChunk * pageSize.value;
        submissionsTotal.value = entry.total;
        submissions.value = entry.items.slice(start, start + pageSize.value);
        prefetchAdjacentSubmissionChunk(filterParams, filterKey, targetPage, entry.total);
      } catch (e) {
        console.error("加载提交记录分页块失败:", e);
        if (throwOnError) throw e;
      } finally {
        if (reqSeq === submissionsReqSeq) {
          isSubmissionsLoading.value = false;
        }
      }
    };

    const loadContests = async ({ throwOnError = false } = {}) => {
      try {
        const res = await apiFetch("/api/contests?platform=all");
        const data = await res.json();
        contests.value = data.contests || [];
        updateContestMetas();
      } catch (e) {
        console.error("加载比赛日程失败:", e);
        if (throwOnError) throw e;
      }
    };

    const syncContestsNow = async () => {
      isSyncingContests.value = true;
      try {
        const res = await apiFetch("/api/contests/sync", { method: "POST", timeoutMs: 120000 });
        const data = await res.json();
        if (data.success) {
          showToast(data.message || "比赛日程刷新成功！", "success");
          await loadContests();
        } else {
          showToast(data.message || "刷新比赛异常", "error");
        }
      } catch (e) {
        showToast("刷新比赛请求失败: " + e.message, "error");
      } finally {
        isSyncingContests.value = false;
      }
    };

    const loadSettings = async ({ includeAccounts = true } = {}) => {
      try {
        const res = await apiFetch("/api/settings");
        const data = await res.json();
        configs.value = data.configs || {};
        platformStatusMap.value = data.status || {};

        const snapshot = {
          poll_interval_minutes: configs.value.poll_interval_minutes || "1440",
          http_proxy: configs.value.http_proxy || "",
          sprint_mode: configs.value.sprint_mode || "false"
        };
        settingsForm.value = { ...snapshot };
        settingsBaseline = { ...snapshot };
        if (includeAccounts) {
          await loadAccounts();
        }
      } catch (e) {
        console.error("加载设置失败:", e);
      }
    };

    // 设置表单脏状态检测
    const isSettingsFormDirty = () => {
      const b = settingsBaseline || {};
      const s = settingsForm.value || {};
      const isProxyChanged = (s.http_proxy || "").trim() !== (b.http_proxy || "").trim();
      const isIntervalChanged = String(s.poll_interval_minutes || "1440") !== String(b.poll_interval_minutes || "1440");
      const isSprintChanged = String(s.sprint_mode || "false") !== String(b.sprint_mode || "false");

      const activeEl = document.activeElement;
      const isInputFocused = currentTab.value === "settings" && activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.tagName === "SELECT");

      return isProxyChanged || isIntervalChanged || isSprintChanged || isInputFocused;
    };

    // 静默轮询设置与多账号状态
    const pollSettingsReadOnly = async ({ throwOnError = false } = {}) => {
      try {
        const res = await apiFetch("/api/settings");
        const data = await res.json();
        if (data.status) {
          platformStatusMap.value = data.status;
        }

        if (data.configs) {
          configs.value = data.configs;
          if (!isSettingsFormDirty()) {
            const incoming = {
              poll_interval_minutes: data.configs.poll_interval_minutes || "1440",
              http_proxy: data.configs.http_proxy || "",
              sprint_mode: data.configs.sprint_mode || "false"
            };
            settingsForm.value = { ...incoming };
            settingsBaseline = { ...incoming };
          }
        }

        // A6-4: 账号弹窗开启编辑时暂停替换 accounts，保护弹窗焦点与表单
        if (!accountModalOpen.value) {
          await loadAccounts();
        }
      } catch (e) {
        console.error("静默轮询设置失败:", e);
        if (throwOnError) throw e;
      }
    };

    const reloadAllData = async () => {
      if (!isLoggedIn.value) return;
      // 首屏严格按当前 Tab 惰性加载，避免在数据总览页白拉提交记录/完整错题/账号列表
      const tab = currentTab.value;
      const tasks = [
        loadOverview(),
        loadContests(),
        loadDueMistakes(),
        loadSettings({ includeAccounts: tab === "settings" })
      ];
      if (tab === "overview") {
        tasks.push(loadHeatmap(), loadTags());
      } else if (tab === "submissions") {
        tasks.push(loadSubmissions({ forceRefresh: true }), loadMistakeKeys(), loadTags());
      } else if (tab === "mistakes") {
        tasks.push(loadMistakes());
      }
      await Promise.allSettled(tasks);
      await nextTick();
      syncSegmentedThumbs();
      if (currentTab.value === "overview") {
        renderHeatmap(true);
        renderActiveChart(true);
      }
    };

    // --- ECharts 渲染系统 (Apple Pro 调色 + macOS 15 磨砂 Tooltip + 1:1 自适应纯正方形热力图) ---
    const prefersReducedMotion = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

    const getGlassTooltipStyle = (dark) => ({
      padding: [9, 14],
      backgroundColor: dark
        ? (glassMode.value ? "rgba(20, 26, 39, 0.80)" : "rgba(20, 22, 28, 0.96)")
        : (glassMode.value ? "rgba(255, 255, 255, 0.84)" : "rgba(255, 255, 255, 0.96)"),
      borderColor: dark
        ? (glassMode.value ? "rgba(255, 255, 255, 0.16)" : "rgba(255, 255, 255, 0.12)")
        : (glassMode.value ? "rgba(15, 23, 42, 0.10)" : "rgba(15, 23, 42, 0.09)"),
      borderWidth: 1,
      textStyle: {
        color: dark ? "#f4f6fb" : "#0f172a",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "SF Pro Text", sans-serif',
        fontSize: getChartFontSize(12)
      },
      extraCssText: glassMode.value
        ? (dark
          ? "border-radius: 11px; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 14px 34px rgba(0, 0, 0, 0.45); backdrop-filter: blur(16px) saturate(170%); -webkit-backdrop-filter: blur(16px) saturate(170%); z-index: 99999;"
          : "border-radius: 11px; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.95), 0 12px 30px rgba(15, 23, 42, 0.16); backdrop-filter: blur(16px) saturate(170%); -webkit-backdrop-filter: blur(16px) saturate(170%); z-index: 99999;")
        : "border-radius: 10px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2); z-index: 99999;"
    });

    const renderHeatmap = (force = false) => {
      const chartDom = document.getElementById("heatmap-chart");
      if (!chartDom) return;

      const outer = chartDom.parentElement;
      const outerWidth = outer ? outer.clientWidth : 800;

      // 类 GitHub 紧凑精致格子比例：步长严格控制在 12px ~ 18px（4K/宽屏也不膨大，保留宽松呼吸间距）
      const leftOffset = 24;
      const rightPadding = 8;
      const topOffset = 24;
      const availableWidth = Math.max(0, outerWidth - 24);
      let cellSize = Math.floor(((availableWidth - leftOffset - rightPadding) / 53) * 2) / 2;
      if (cellSize < 12) cellSize = 12;
      if (cellSize > 18) cellSize = 18;

      // 根据动态单元格精确确定图表尺寸，保证居中且无多余空白
      const contentWidth = Math.ceil(cellSize * 53 + leftOffset + rightPadding);
      const contentHeight = Math.ceil(cellSize * 7 + topOffset + 10);

      const sizeChanged = contentWidth !== lastHeatmapCanvasW || contentHeight !== lastHeatmapCanvasH;
      if (sizeChanged) {
        chartDom.style.width = `${contentWidth}px`;
        chartDom.style.height = `${contentHeight}px`;
        chartDom.style.margin = "0 auto";
        lastHeatmapCanvasW = contentWidth;
        lastHeatmapCanvasH = contentHeight;
      }

      let chart = echarts.getInstanceByDom(chartDom);
      if (!chart) {
        chart = markRaw(echarts.init(chartDom));
      }
      heatmapChart = chart;

      const dark = isDark.value;
      const targetYear = selectedHeatmapYear.value || new Date().getFullYear();
      const rawList = rawHeatmap.value || [];
      const currentDataStr = lastHeatmapDataStr || JSON.stringify(rawList);
      const displayKey = `${targetYear}_${heatmapFilter.value}_${dark ? 'dark' : 'light'}_${glassMode.value ? 'g1' : 'g0'}_${cellSize}`;
      const currentKey = `${displayKey}##${currentDataStr}`;

      // A4 / A7-1: 真实数据内容与显示参数未变且非强制时跳过重绘
      if (!force && currentKey === lastHeatmapRenderKey) {
        if (sizeChanged) chart.resize();
        return;
      }
      lastHeatmapRenderKey = currentKey;

      const startDateStr = `${targetYear}-01-01`;
      const endDateStr = `${targetYear}-12-31`;

      // 补齐全年 365/366 天数据（复用年份日期缓存，避免每次切年重复分配 366 个 Date 对象）
      const dayStatMap = new Map();
      const yearPrefix = `${targetYear}`;
      for (let i = 0; i < rawList.length; i++) {
        const item = rawList[i];
        if (item.date && item.date.startsWith(yearPrefix)) {
          dayStatMap.set(item.date, {
            count: item.count || 0,
            unique_ac: item.unique_ac || 0
          });
        }
      }

      const yearDates = getYearDatesList(targetYear);
      const heatMapData = new Array(yearDates.length);
      for (let i = 0; i < yearDates.length; i++) {
        const dStr = yearDates[i];
        const st = dayStatMap.get(dStr);
        heatMapData[i] = [dStr, st ? st.count : 0, st ? st.unique_ac : 0];
      }

      // GitHub 风格分位数自适应 4 阶色深（确保不同刷题强度下 4 个绿色阶梯都清晰可辨）
      const nonZeroCounts = heatMapData
        .map(item => item[1] || 0)
        .filter(v => v > 0)
        .sort((a, b) => a - b);

      let t1 = 1, t2 = 3, t3 = 6;
      if (nonZeroCounts.length >= 4) {
        const q25 = nonZeroCounts[Math.floor((nonZeroCounts.length - 1) * 0.25)];
        const q50 = nonZeroCounts[Math.floor((nonZeroCounts.length - 1) * 0.50)];
        const q75 = nonZeroCounts[Math.floor((nonZeroCounts.length - 1) * 0.75)];
        t1 = Math.max(1, q25);
        t2 = Math.max(t1 + 1, q50);
        t3 = Math.max(t2 + 1, q75);
      }

      heatmapLegendTips.value = [
        t1 === 1 ? "1 发" : `1-${t1} 发`,
        t1 + 1 === t2 ? `${t2} 发` : `${t1 + 1}-${t2} 发`,
        t2 + 1 === t3 ? `${t3} 发` : `${t2 + 1}-${t3} 发`,
        `≥${t3 + 1} 发`
      ];

      // GitHub 原生质感调色板（兼容通透毛玻璃底托）
      const ghPalette = dark
        ? {
            empty: "rgba(255, 255, 255, 0.065)",
            emptyBorder: "rgba(255, 255, 255, 0.065)",
            activeBorder: "rgba(255, 255, 255, 0.10)",
            l1: "#0e4429",
            l2: "#006d32",
            l3: "#26a641",
            l4: "#39d353"
          }
        : {
            empty: "rgba(27, 31, 35, 0.065)",
            emptyBorder: "rgba(27, 31, 35, 0.075)",
            activeBorder: "rgba(27, 31, 35, 0.09)",
            l1: "#9be9a8",
            l2: "#40c463",
            l3: "#30a14e",
            l4: "#216e39"
          };

      const cellGap = Math.max(3.5, Math.round(cellSize * 0.30 * 2) / 2);
      const boxSize = Math.max(7.5, +(cellSize - cellGap).toFixed(1));
      const boxRadius = Math.max(2, Math.min(3, +(boxSize * 0.22).toFixed(1)));

      const option = {
        tooltip: {
          trigger: "item",
          appendToBody: true,
          confine: false,
          position: function (point, params, dom, rect, size) {
            const x = point[0];
            const y = point[1];
            const boxW = (size && size.contentSize && size.contentSize[0]) || 130;
            const boxH = (size && size.contentSize && size.contentSize[1]) || 56;
            const viewW = (size && size.viewSize && size.viewSize[0]) || contentWidth;
            const left = (x + boxW + 16 > viewW) ? Math.max(8, x - boxW - 14) : (x + 14);
            const top = Math.max(-boxH, y - boxH / 2);
            return [left, top];
          },
          ...getGlassTooltipStyle(dark),
          formatter: function (p) {
            if (!p || !Array.isArray(p.value)) return "";
            const date = p.value[0];
            const subs = p.value[1] || 0;
            const ac = p.value[2] || 0;
            let html = `<div class="font-mono text-xs font-semibold" style="color: ${dark ? '#9ca3af' : '#656d76'}">${date}</div>`;
            if (subs <= 0) {
              html += `<div class="text-xs mt-1 font-sans" style="color: ${dark ? '#7d8590' : '#8c959f'};">暂无提交</div>`;
            } else {
              html += `<div class="text-xs font-bold mt-1 font-sans" style="color: ${dark ? '#39d353' : '#1a7f37'};">提交: ${subs} 发</div>`;
              if (ac > 0) {
                html += `<div class="text-xs font-medium mt-0.5 font-sans" style="color: ${dark ? '#9ca3af' : '#57606a'};">AC: ${ac} 题</div>`;
              }
            }
            return html;
          }
        },
        calendar: {
          top: topOffset,
          left: leftOffset,
          z: 1,
          silent: true,
          cellSize: [cellSize, cellSize],
          range: [startDateStr, endDateStr],
          itemStyle: {
            color: "transparent",
            borderWidth: 0
          },
          splitLine: { show: false },
          yearLabel: { show: false },
          dayLabel: {
            firstDay: 1,
            nameMap: ["", "一", "", "三", "", "五", ""],
            margin: 6,
            color: dark ? "#7d8590" : "#656d76",
            fontSize: 10.5,
            fontFamily: "JetBrains Mono"
          },
          monthLabel: {
            margin: 8,
            color: dark ? "#8b949e" : "#57606a",
            fontSize: 11,
            fontFamily: "JetBrains Mono"
          }
        },
        animation: false,
        series: [{
          type: "custom",
          z: 5,
          animation: false,
          coordinateSystem: "calendar",
          encode: {
            calendar: 0,
            tooltip: [0, 1, 2]
          },
          renderItem: function (params, api) {
            const center = api.coord([api.value(0)]);
            if (!center) return null;
            const count = Number(api.value(1) || 0);
            const fillColor = count <= 0
              ? ghPalette.empty
              : count <= t1
                ? ghPalette.l1
                : count <= t2
                  ? ghPalette.l2
                  : count <= t3
                    ? ghPalette.l3
                    : ghPalette.l4;
            return {
              type: "group",
              children: [
                {
                  type: "rect",
                  silent: false,
                  shape: {
                    x: center[0] - cellSize / 2,
                    y: center[1] - cellSize / 2,
                    width: cellSize,
                    height: cellSize
                  },
                  style: {
                    fill: "rgba(0, 0, 0, 0)"
                  },
                  emphasis: {
                    style: {
                      fill: "rgba(0, 0, 0, 0)"
                    }
                  }
                },
                {
                  type: "rect",
                  silent: false,
                  shape: {
                    x: center[0] - boxSize / 2,
                    y: center[1] - boxSize / 2,
                    width: boxSize,
                    height: boxSize,
                    r: boxRadius
                  },
                  style: {
                    fill: fillColor,
                    stroke: count === 0 ? ghPalette.emptyBorder : ghPalette.activeBorder,
                    lineWidth: 0.75
                  },
                  emphasis: {
                    style: {
                      stroke: dark ? "#c9d1d9" : "#1f2328",
                      lineWidth: 1.25
                    }
                  }
                }
              ]
            };
          },
          data: heatMapData
        }]
      };

      chart.setOption(option, true);
      if (sizeChanged) {
        chart.resize();
      }
    };

    // 1. 累计解题成长曲线 (Unique AC Progress Curve) - 数据与顶部 total_ac 严格一致
    const renderClimbingChart = (force = false) => {
      const chartDom = document.getElementById("analytics-chart");
      if (!chartDom) return;

      let chart = echarts.getInstanceByDom(chartDom);
      if (!chart) {
        chart = markRaw(echarts.init(chartDom));
      }
      analyticsChart = chart;

      const dark = isDark.value;
      const rawCurve = overview.value.climbing_curve || [];
      const currentDataStr = JSON.stringify(rawCurve);
      const displayKey = `climbing_${dark ? 'dark' : 'light'}_${glassMode.value ? 'g1' : 'g0'}_${isCurveSmooth.value}_${getChartFontSize(12)}`;
      const currentKey = `${displayKey}##${currentDataStr}`;

      if (!force && chart && currentKey === lastClimbingKey) {
        chart.resize();
        return;
      }
      lastClimbingKey = currentKey;
      chart.clear();
      
      // 保证数据序列严格按日历连续，最小刻度单位为严格 1 天（杜绝跳天导致非等距）
      let dates = [];
      let values = [];
      let newAcs = [];

      if (rawCurve.length > 0) {
        // 双重保障：补齐缺失的每一天，确保每一天的横坐标宽度绝对一致（最小单位 1 天）
        const curveMap = new Map();
        rawCurve.forEach(item => curveMap.set(item.date, item));
        
        let startDt = new Date(rawCurve[0].date + "T00:00:00");
        const endDt = new Date(rawCurve[rawCurve.length - 1].date + "T00:00:00");
        let lastAc = rawCurve[0].ac;

        while (startDt <= endDt) {
          const yyyy = startDt.getFullYear();
          const mm = String(startDt.getMonth() + 1).padStart(2, '0');
          const dd = String(startDt.getDate()).padStart(2, '0');
          const dStr = `${yyyy}-${mm}-${dd}`;
          if (curveMap.has(dStr)) {
            const it = curveMap.get(dStr);
            lastAc = it.ac;
            dates.push(dStr);
            values.push(it.ac);
            newAcs.push(it.new_ac || 0);
          } else {
            dates.push(dStr);
            values.push(lastAc);
            newAcs.push(0);
          }
          startDt.setDate(startDt.getDate() + 1);
        }
      } else {
        const todayStr = getLocalDateStr(0);
        dates = [todayStr];
        values = [overview.value.stats?.total_ac || 0];
        newAcs = [0];
      }

      // 计算 Y 轴动态起点：按用户需求算法（取最左侧一天即一年前最低的累计通过量，除最高位其余位置0）
      // 获得当前数的量级次幂，整除该次幂再乘上该次幂，使曲线走势更突出、斜率更显著，每天动态更新
      let yMin = 0;
      if (values.length > 0) {
        const leftmostVal = values[0];
        if (leftmostVal > 0) {
          const s = Math.floor(leftmostVal).toString();
          if (s.length > 1) {
            const power = Math.pow(10, s.length - 1);
            yMin = Math.floor(leftmostVal / power) * power;
          }
        }
      }
      const maxVal = values.length > 0 ? Math.max(...values) : 0;
      let yMax = undefined;
      if (maxVal <= yMin && yMin > 0) {
        yMax = yMin + 10;
      }

      // 高斯核时间加权平滑算法：消除离散台阶产生的 90 度直角生硬感，将阶跃平滑为丝滑自然的 S 曲线
      const gaussianSmooth = (arr, radius = 4, sigma = 2.0) => {
        if (!arr || arr.length <= 2) return arr.slice();
        const weights = [];
        for (let k = -radius; k <= radius; k++) {
          weights.push(Math.exp(-0.5 * Math.pow(k / sigma, 2)));
        }
        const wSum = weights.reduce((a, b) => a + b, 0);
        const normWeights = weights.map(w => w / wSum);
        const res = [];
        const n = arr.length;
        for (let i = 0; i < n; i++) {
          let s = 0.0;
          let wAcc = 0.0;
          for (let ki = 0; ki < normWeights.length; ki++) {
            const idx = i + (ki - radius);
            if (idx >= 0 && idx < n) {
              s += arr[idx] * normWeights[ki];
              wAcc += normWeights[ki];
            }
          }
          res.push(Number((s / wAcc).toFixed(2)));
        }
        res[0] = arr[0];
        res[n - 1] = arr[n - 1];
        return res;
      };

      const displayValues = isCurveSmooth.value ? gaussianSmooth(values, 4, 2.0) : values;

      const option = {
        animation: !prefersReducedMotion(),
        animationDuration: 420,
        tooltip: {
          trigger: "axis",
          axisPointer: {
            type: "line",
            lineStyle: {
              color: dark ? "rgba(255, 255, 255, 0.22)" : "rgba(15, 23, 42, 0.16)",
              width: 1,
              type: "dashed"
            }
          },
          ...getGlassTooltipStyle(dark),
          formatter: function (params) {
            const p = params[0];
            const idx = p.dataIndex;
            const realVal = values[idx]; // 始终显示真实的整数累计通过量
            const newCount = newAcs[idx] || 0;
            let html = `<div class="font-sans text-xs font-semibold" style="color: ${dark ? '#b0b8c9' : '#596377'}">${p.name}</div>`;
            html += `<div class="text-xs font-bold mt-1 font-sans" style="color:${dark ? '#4da3ff' : '#0071e3'}">累计 AC: ${realVal} 题</div>`;
            if (newCount > 0) {
              html += `<div class="text-xs font-medium mt-0.5 font-sans" style="color:${dark ? '#39d353' : '#15803d'}">当日新过: +${newCount} 题</div>`;
            }
            return html;
          }
        },
        grid: {
          left: "3%",
          right: "4%",
          bottom: "8%",
          top: "8%",
          containLabel: true
        },
        xAxis: {
          type: "category",
          data: dates,
          boundaryGap: false,
          axisLine: { lineStyle: { color: dark ? "rgba(255, 255, 255, 0.1)" : "rgba(15, 23, 42, 0.08)" } },
          axisLabel: { 
            color: dark ? "#98a1b2" : "#596377", 
            fontSize: getChartFontSize(10), 
            fontFamily: "JetBrains Mono",
            formatter: (val) => val.slice(2) // YY-MM-DD
          }
        },
        yAxis: {
          type: "value",
          min: yMin,
          ...(yMax !== undefined ? { max: yMax } : {}),
          minInterval: 1,
          splitLine: { lineStyle: { color: dark ? "rgba(255, 255, 255, 0.06)" : "rgba(15, 23, 42, 0.05)" } },
          axisLabel: { color: dark ? "#98a1b2" : "#596377", fontSize: getChartFontSize(10), fontFamily: "JetBrains Mono" }
        },
        series: [{
          name: "累计 AC",
          type: "line",
          smooth: isCurveSmooth.value ? 0.45 : false,
          showSymbol: false,
          symbol: "circle",
          symbolSize: 6,
          itemStyle: { color: dark ? "#2997ff" : "#0071e3" },
          lineStyle: { width: 2.5, color: dark ? "#2997ff" : "#0071e3" },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, dark ? [
              { offset: 0, color: "rgba(41, 151, 255, 0.32)" },
              { offset: 1, color: "rgba(41, 151, 255, 0.0)" }
            ] : [
              { offset: 0, color: "rgba(0, 113, 227, 0.25)" },
              { offset: 1, color: "rgba(0, 113, 227, 0.0)" }
            ])
          },
          data: displayValues
        }]
      };

      chart.setOption(option, true);
      chart.resize();
    };

    // 2. 每日提交与通过分析 (Daily Activity & Solved Distribution)
    const renderDailyEffortChart = (force = false) => {
      const chartDom = document.getElementById("analytics-chart");
      if (!chartDom) return;

      let chart = echarts.getInstanceByDom(chartDom);
      if (!chart) {
        chart = markRaw(echarts.init(chartDom));
      }
      analyticsChart = chart;

      const dark = isDark.value;
      const rawDaily = overview.value.daily_effort || [];
      const currentDataStr = JSON.stringify(rawDaily);
      const displayKey = `daily_${dark ? 'dark' : 'light'}_${glassMode.value ? 'g1' : 'g0'}_${getChartFontSize(12)}`;
      const currentKey = `${displayKey}##${currentDataStr}`;

      if (!force && chart && currentKey === lastDailyKey) {
        chart.resize();
        return;
      }
      lastDailyKey = currentKey;
      chart.clear();

      let dates = [];
      let fullDates = [];
      let acList = [];
      let nonAcList = [];
      let totalList = [];

      if (rawDaily.length > 0) {
        // 每日提交仅统计有提交行为的活跃日期，不填充空白无提交日
        const activeDaily = rawDaily.filter(item => (item.total_subs || 0) > 0);
        const list = activeDaily.length > 0 ? activeDaily : rawDaily;
        dates = list.map(item => item.date ? item.date.slice(2) : "");
        fullDates = list.map(item => item.date);
        acList = list.map(item => item.unique_ac || 0);
        nonAcList = list.map(item => Math.max(0, (item.total_subs || 0) - (item.unique_ac || 0)));
        totalList = list.map(item => item.total_subs || 0);
      } else {
        const todayStr = getLocalDateStr(0);
        dates = [todayStr.slice(2)];
        fullDates = [todayStr];
        acList = [overview.value.stats?.today_ac || 0];
        nonAcList = [Math.max(0, (overview.value.stats?.today_subs || 0) - (overview.value.stats?.today_ac || 0))];
        totalList = [overview.value.stats?.today_subs || 0];
      }

      const option = {
        animation: !prefersReducedMotion(),
        animationDuration: 420,
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "shadow" },
          ...getGlassTooltipStyle(dark),
          formatter: function (params) {
            const idx = params[0]?.dataIndex ?? 0;
            const date = fullDates[idx] || "";
            const ac = acList[idx] || 0;
            const total = totalList[idx] || 0;
            let html = `<div class="font-sans text-xs font-semibold" style="color: ${dark ? '#b0b8c9' : '#596377'}">${date}</div>`;
            html += `<div class="text-xs font-bold mt-1 font-sans" style="color: ${dark ? '#4da3ff' : '#0071e3'}">过题 (AC): ${ac} 题</div>`;
            html += `<div class="text-xs font-medium mt-0.5 font-sans" style="color: ${dark ? '#b0b8c9' : '#596377'}">总提交: ${total} 发</div>`;
            if (total > 0) {
              const rate = Math.round((ac / total) * 100);
              html += `<div class="text-[11px] font-mono mt-0.5" style="color: ${dark ? '#39d353' : '#15803d'}">过题率: ${rate}%</div>`;
            }
            return html;
          }
        },
        legend: {
          top: 8,
          right: 20,
          icon: "roundRect",
          itemWidth: 10,
          itemHeight: 10,
          textStyle: {
            color: dark ? "#b0b8c9" : "#3f4859",
            fontSize: getChartFontSize(11),
            fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", sans-serif'
          },
          data: ["AC 过题", "非 AC 提交"]
        },
        grid: {
          left: "3%",
          right: "4%",
          bottom: "8%",
          top: "14%",
          containLabel: true
        },
        xAxis: {
          type: "category",
          data: dates,
          axisLine: { lineStyle: { color: dark ? "rgba(255, 255, 255, 0.1)" : "rgba(15, 23, 42, 0.08)" } },
          axisLabel: { color: dark ? "#98a1b2" : "#596377", fontSize: getChartFontSize(10), fontFamily: "JetBrains Mono" }
        },
        yAxis: {
          type: "value",
          splitLine: { lineStyle: { color: dark ? "rgba(255, 255, 255, 0.06)" : "rgba(15, 23, 42, 0.05)" } },
          axisLabel: { color: dark ? "#98a1b2" : "#596377", fontSize: getChartFontSize(10), fontFamily: "JetBrains Mono" }
        },
        series: [
          {
            name: "AC 过题",
            type: "bar",
            stack: "total",
            barMaxWidth: 16,
            itemStyle: {
              borderRadius: [0, 0, 0, 0],
              color: dark ? "#3b96ff" : "#0071e3"
            },
            data: acList
          },
          {
            name: "非 AC 提交",
            type: "bar",
            stack: "total",
            barMaxWidth: 16,
            itemStyle: {
              borderRadius: [3, 3, 0, 0],
              color: dark ? "rgba(148, 163, 184, 0.24)" : "rgba(15, 23, 42, 0.12)"
            },
            data: nonAcList
          }
        ]
      };

      chart.setOption(option, true);
      chart.resize();
    };

    // 3. 算法标签掌握分布
    const renderTagBarChart = (force = false) => {
      const chartDom = document.getElementById("analytics-chart");
      if (!chartDom) return;

      let chart = echarts.getInstanceByDom(chartDom);
      if (!chart) {
        chart = markRaw(echarts.init(chartDom));
      }
      analyticsChart = chart;

      const dark = isDark.value;
      const topTags = (tagStats.value || []).slice(0, 10).reverse();
      const currentDataStr = JSON.stringify(topTags);
      const displayKey = `tags_${dark ? 'dark' : 'light'}_${glassMode.value ? 'g1' : 'g0'}_${getChartFontSize(12)}`;
      const currentKey = `${displayKey}##${currentDataStr}`;

      if (!force && chart && currentKey === lastTagChartKey) {
        chart.resize();
        return;
      }
      lastTagChartKey = currentKey;
      chart.clear();
      const categories = topTags.map(t => t.tag);
      const acData = topTags.map(t => t.ac_count);

      const option = {
        animation: !prefersReducedMotion(),
        animationDuration: 420,
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "shadow" },
          ...getGlassTooltipStyle(dark),
          formatter: function (params) {
            const p = params[0];
            const col = dark ? '#4da3ff' : '#0071e3';
            return `<div class="font-sans text-xs font-semibold" style="color: ${dark ? '#b0b8c9' : '#596377'}">${p.name}</div><div class="text-xs font-bold mt-1 font-sans" style="color:${col}">AC 题数: ${p.value} 题</div>`;
          }
        },
        grid: {
          left: "3%",
          right: "10%",
          bottom: "8%",
          top: "6%",
          containLabel: true
        },
        xAxis: {
          type: "value",
          splitLine: { lineStyle: { color: dark ? "rgba(255, 255, 255, 0.06)" : "rgba(15, 23, 42, 0.05)" } },
          axisLabel: { color: dark ? "#98a1b2" : "#596377", fontSize: getChartFontSize(10), fontFamily: "JetBrains Mono" }
        },
        yAxis: {
          type: "category",
          data: categories,
          axisLine: { lineStyle: { color: dark ? "rgba(255, 255, 255, 0.1)" : "rgba(15, 23, 42, 0.08)" } },
          axisLabel: { color: dark ? "#f4f6fb" : "#0f172a", fontSize: getChartFontSize(11), fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "SF Pro Text", sans-serif' }
        },
        series: [{
          name: "AC 题数",
          type: "bar",
          barMaxWidth: 20,
          data: acData,
          label: {
            show: true,
            position: "right",
            distance: 6,
            color: dark ? "#b0b8c9" : "#3f4859",
            fontFamily: "JetBrains Mono, ui-monospace, monospace",
            fontSize: getChartFontSize(11),
            fontWeight: 600
          },
          itemStyle: {
            borderRadius: [0, 6, 6, 0],
            color: new echarts.graphic.LinearGradient(0, 0, 1, 0, dark ? [
              { offset: 0, color: "rgba(59, 150, 255, 0.30)" },
              { offset: 1, color: "#3b96ff" }
            ] : [
              { offset: 0, color: "rgba(0, 113, 227, 0.35)" },
              { offset: 1, color: "#0071e3" }
            ])
          }
        }]
      };

      chart.setOption(option, true);
      chart.resize();
    };

    // 4. 各平台题量占比分布
    const renderPlatformPie = (force = false) => {
      const chartDom = document.getElementById("analytics-chart");
      if (!chartDom) return;

      let chart = echarts.getInstanceByDom(chartDom);
      if (!chart) {
        chart = markRaw(echarts.init(chartDom));
      }
      analyticsChart = chart;

      const dark = isDark.value;
      const pData = overview.value.stats?.platforms || {};
      const currentDataStr = JSON.stringify(pData);
      const displayKey = `platforms_${dark ? 'dark' : 'light'}_${glassMode.value ? 'g1' : 'g0'}_${getChartFontSize(12)}`;
      const currentKey = `${displayKey}##${currentDataStr}`;

      if (!force && chart && currentKey === lastPieKey) {
        chart.resize();
        return;
      }
      lastPieKey = currentKey;
      chart.clear();
      const data = [
        { value: pData.codeforces?.ac || 0, name: "Codeforces", itemStyle: { color: dark ? "#4da3ff" : "#0071e3" } },
        { value: pData.atcoder?.ac || 0, name: "AtCoder", itemStyle: { color: dark ? "#b197fc" : "#7c3aed" } },
        { value: pData.luogu?.ac || 0, name: "洛谷", itemStyle: { color: dark ? "#39d353" : "#15803d" } },
        { value: pData.acwing?.ac || 0, name: "AcWing", itemStyle: { color: dark ? "#818cf8" : "#4f46e5" } },
        { value: (pData.leetcode?.ac || 0) + (pData.leetcode_cn?.ac || 0), name: "力扣", itemStyle: { color: dark ? "#f59e0b" : "#d97706" } }
      ].filter(d => d.value > 0);

      const option = {
        animation: !prefersReducedMotion(),
        animationDuration: 420,
        tooltip: {
          trigger: "item",
          ...getGlassTooltipStyle(dark),
          formatter: function (p) {
            return `<div class="font-sans text-xs font-semibold">${p.name}</div><div class="font-mono text-xs font-bold mt-1">${p.value} 题 (${p.percent}%)</div>`;
          }
        },
        legend: {
          bottom: "6%",
          left: "center",
          icon: "circle",
          itemWidth: 8,
          itemHeight: 8,
          textStyle: { color: dark ? "#b0b8c9" : "#3f4859", fontSize: getChartFontSize(11), fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", sans-serif' }
        },
        series: [{
          name: "各平台 AC 分布",
          type: "pie",
          radius: ["45%", "70%"],
          center: ["50%", "48%"],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 8,
            borderColor: dark ? "rgba(17, 21, 31, 0.85)" : "rgba(255, 255, 255, 0.88)",
            borderWidth: 3
          },
          label: { show: false },
          emphasis: {
            label: {
              show: true,
              fontSize: getChartFontSize(15),
              fontWeight: "bold",
              color: dark ? "#f4f6fb" : "#0f172a"
            }
          },
          data: data.length ? data : [{ value: 0, name: "暂无数据", itemStyle: { color: dark ? "#2c2c2e" : "#e2e8f0" } }]
        }]
      };

      chart.setOption(option, true);
      chart.resize();
    };

    const renderActiveChart = (force = false) => {
      if (chartView.value === "climbing") {
        renderClimbingChart(force);
      } else if (chartView.value === "daily") {
        renderDailyEffortChart(force);
      } else if (chartView.value === "tags") {
        renderTagBarChart(force);
      } else if (chartView.value === "platforms") {
        renderPlatformPie(force);
      }
    };

    // --- Platform & Sync Actions ---
    const setHeatmapFilter = async (p) => {
      if (heatmapFilter.value === p) return;
      heatmapFilter.value = p;
      // 立即滑动分段指示器，杜绝等待网络往返导致的点击卡顿感
      nextTick(syncSegmentedThumbs);
      try {
        await loadHeatmap({ useCacheFirst: true });
      } catch (e) {
        // handled
      }
    };

    const setHeatmapYear = async (yr) => {
      if (selectedHeatmapYear.value === yr) return;
      selectedHeatmapYear.value = yr;
      // 立即滑动分段指示器，本地命中缓存时 1 帧内完成渲染
      nextTick(syncSegmentedThumbs);
      try {
        await loadHeatmap({ useCacheFirst: true });
      } catch (e) {
        // handled
      }
    };

    const syncNow = async (platform = "all") => {
      isSyncing.value = true;
      try {
        const res = await apiFetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ platform }),
          timeoutMs: 180000
        });
        const data = await res.json();
        if (data.data?.synced_at) {
          overview.value.last_sync_time = data.data.synced_at;
        }
        if (data.success) {
          showToast("同步完成", "success");
        } else {
          showToast("部分平台同步失败", "error");
        }
        invalidateHeatmapCache(true);
        invalidateSubmissionsCache();
        await reloadAllData();
      } catch (e) {
        if (e.message !== "UNAUTHORIZED") {
          showToast("同步请求失败: " + e.message, "error");
        }
      } finally {
        isSyncing.value = false;
        await nextTick();
        if (currentTab.value === "overview") {
          renderHeatmap();
          renderActiveChart();
          syncSegmentedThumbs();
        }
      }
    };

    const toggleSprintMode = async () => {
      const current = configs.value.sprint_mode === "true";
      const next = (!current).toString();
      try {
        await apiFetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sprint_mode: next })
        });
        configs.value.sprint_mode = next;
        settingsForm.value.sprint_mode = next;
        settingsBaseline.sprint_mode = next;
        const regularMins = configs.value.poll_interval_minutes || "1440";
        showToast(next === "true" ? "已切换: 5分钟冲刺" : `已切换: ${formatPollInterval(regularMins)}`, "success");
      } catch (e) {
        showToast("切换失败", "error");
      }
    };

    const saveSystemSettingsOnly = async () => {
      const proxy = (settingsForm.value.http_proxy || "").trim();
      if (proxy && !/^(http|https|socks5|socks5h|socks4):\/\//i.test(proxy)) {
        showToast("代理需以 http:// 或 socks5:// 开头", "error");
        return;
      }
      isSavingSystem.value = true;
      try {
        const minsStr = String(settingsForm.value.poll_interval_minutes || "1440");
        const payload = {
          poll_interval_minutes: minsStr,
          http_proxy: proxy
        };
        const res = await apiFetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          configs.value.poll_interval_minutes = minsStr;
          configs.value.http_proxy = payload.http_proxy;
          settingsBaseline.poll_interval_minutes = minsStr;
          settingsBaseline.http_proxy = proxy;
          showToast("参数已保存", "success");
        } else {
          showToast(data.detail || data.message || "保存失败", "error");
        }
      } catch (e) {
        showToast("保存失败: " + e.message, "error");
      } finally {
        isSavingSystem.value = false;
      }
    };

    const saveSettingsAndSync = async () => {
      const proxy = (settingsForm.value.http_proxy || "").trim();
      if (proxy && !/^(http|https|socks5|socks5h|socks4):\/\//i.test(proxy)) {
        showToast("代理需以 http:// 或 socks5:// 开头", "error");
        return;
      }
      isSaving.value = true;
      try {
        const minsStr = String(settingsForm.value.poll_interval_minutes || "1440");
        const payload = {
          ...settingsForm.value,
          poll_interval_minutes: minsStr,
          http_proxy: proxy
        };
        const res = await apiFetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          configs.value.poll_interval_minutes = minsStr;
          configs.value.http_proxy = payload.http_proxy || "";
          settingsBaseline = {
            ...settingsForm.value,
            poll_interval_minutes: minsStr,
            http_proxy: proxy
          };
          showToast("已保存，正在同步", "success");
          currentTab.value = "overview"; // 自动平滑切回总览看板
          await syncNow("all");
        } else {
          showToast(data.detail || data.message || "保存设置失败", "error");
        }
      } catch (e) {
        showToast("保存设置失败: " + e.message, "error");
      } finally {
        isSaving.value = false;
      }
    };

    // --- Multi-Account Actions ---
    const loadAccounts = async () => {
      try {
        const res = await apiFetch("/api/accounts");
        const data = await res.json();
        if (data.accounts) {
          accounts.value = data.accounts;
        }
      } catch (e) {
        console.error("加载多账号列表失败:", e);
        throw e;
      }
    };

    const openAddAccountModal = (platform = "codeforces") => {
      accountModalMode.value = "add";
      const existing = groupedAccounts.value[platform] || [];
      accountForm.value = {
        id: null,
        platform: platform,
        handle: "",
        cookie: "",
        alias: "",
        is_primary: existing.length === 0
      };
      accountModalOpen.value = true;
    };

    const openEditAccountModal = (account) => {
      accountModalMode.value = "edit";
      accountForm.value = {
        id: account.id,
        platform: account.platform,
        handle: account.handle,
        cookie: account.cookie || "",
        alias: account.alias || "",
        is_primary: !!account.is_primary
      };
      accountModalOpen.value = true;
    };

    const handleSaveAccount = async () => {
      if (!accountForm.value.handle || !accountForm.value.handle.trim()) {
        showToast("请输入账号标识 (用户名/UID)", "error");
        return;
      }
      isAccountSubmitting.value = true;
      try {
        if (accountModalMode.value === "add") {
          const payload = {
            platform: accountForm.value.platform,
            handle: accountForm.value.handle.trim(),
            cookie: accountForm.value.cookie ? accountForm.value.cookie.trim() : "",
            alias: accountForm.value.alias ? accountForm.value.alias.trim() : "",
            is_primary: !!accountForm.value.is_primary
          };
          const res = await apiFetch("/api/accounts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (!res.ok || data.detail) {
            showToast(data.detail || "添加账号失败", "error");
            return;
          }
          showToast("账号添加成功", "success");
          accountModalOpen.value = false;
          await Promise.all([loadAccounts(), loadSettings(), loadOverview()]);
        } else {
          const payload = {
            handle: accountForm.value.handle.trim(),
            cookie: accountForm.value.cookie ? accountForm.value.cookie.trim() : "",
            alias: accountForm.value.alias ? accountForm.value.alias.trim() : "",
            is_primary: !!accountForm.value.is_primary
          };
          const res = await apiFetch(`/api/accounts/${accountForm.value.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (!res.ok || data.detail) {
            showToast(data.detail || "更新账号失败", "error");
            return;
          }
          showToast("账号更新成功", "success");
          accountModalOpen.value = false;
          await Promise.all([loadAccounts(), loadSettings(), loadOverview()]);
        }
      } catch (e) {
        showToast("保存失败: " + e.message, "error");
      } finally {
        isAccountSubmitting.value = false;
      }
    };

    const handleDeleteAccount = async (account) => {
      if (!confirm(`移除账号 [${account.alias || account.handle}]？（历史记录将保留）`)) {
        return;
      }
      try {
        const res = await apiFetch(`/api/accounts/${account.id}`, {
          method: "DELETE"
        });
        const data = await res.json();
        if (!res.ok || data.detail) {
          showToast(data.detail || "删除失败", "error");
          return;
        }
        showToast("账号已移除", "success");
        await Promise.all([loadAccounts(), loadSettings(), loadOverview()]);
      } catch (e) {
        showToast("删除账号失败: " + e.message, "error");
      }
    };

    const handleSetPrimaryAccount = async (account) => {
      try {
        const res = await apiFetch(`/api/accounts/${account.id}/primary`, {
          method: "POST"
        });
        const data = await res.json();
        if (!res.ok || data.detail) {
          showToast(data.detail || "设置主账号失败", "error");
          return;
        }
        showToast(`已将 [${account.alias || account.handle}] 设为主账号`, "success");
        await Promise.all([loadAccounts(), loadSettings()]);
      } catch (e) {
        showToast("操作失败: " + e.message, "error");
      }
    };

    const handleSyncSingleAccount = async (account) => {
      isAccountSyncing.value[account.id] = true;
      try {
        const res = await apiFetch(`/api/accounts/${account.id}/sync`, {
          method: "POST",
          timeoutMs: 120000
        });
        const data = await res.json();
        if (!res.ok || data.detail) {
          showToast(data.detail || "同步请求失败", "error");
          return;
        }
        if (data.success === false) {
          showToast(`[${account.alias || account.handle}] 同步未完成: ${data.message || "请求失败"}`, "error");
          await Promise.all([loadAccounts(), loadSettings()]);
          return;
        }
        const count = data.count !== undefined ? data.count : (data.new_submissions !== undefined ? data.new_submissions : 0);
        showToast(`[${account.alias || account.handle}] 同步完成: +${count} 发`, "success");
        invalidateHeatmapCache(true);
        invalidateSubmissionsCache();
        const tasks = [loadAccounts(), loadOverview(), loadDueMistakes(), loadMistakeKeys()];
        if (currentTab.value === "overview") tasks.push(loadHeatmap({ forceNetwork: true }), loadTags());
        if (currentTab.value === "submissions") tasks.push(loadSubmissions({ forceRefresh: true }));
        if (currentTab.value === "mistakes") tasks.push(loadMistakes());
        await Promise.allSettled(tasks);
        if (currentTab.value === "overview") {
          renderHeatmap();
          renderActiveChart();
          syncSegmentedThumbs();
        }
      } catch (e) {
        showToast("同步失败: " + e.message, "error");
      } finally {
        isAccountSyncing.value[account.id] = false;
      }
    };

    const handleVerifySingleAccount = async (account) => {
      isAccountTesting.value[account.id] = true;
      try {
        const res = await apiFetch("/api/accounts/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            platform: account.platform,
            handle: account.handle,
            cookie: account.cookie || "",
            http_proxy: settingsForm.value.http_proxy || configs.value.http_proxy || ""
          }),
          timeoutMs: 60000
        });
        const data = await res.json();
        if (data.valid) {
          showToast(data.message || `账号 [${account.handle}] 连通性测试通过`, "success");
        } else {
          showToast(data.message || `账号 [${account.handle}] 连通性测试未通过`, "error");
        }
        await loadAccounts();
      } catch (e) {
        showToast("连通性测试异常: " + e.message, "error");
      } finally {
        isAccountTesting.value[account.id] = false;
      }
    };

    const syncPlatformManual = async (platform) => {
      if (platform === 'leetcode') {
        showToast("已刷新力扣最新记录", "info");
        invalidateHeatmapCache(true);
        invalidateSubmissionsCache();
        try {
          const tasks = [loadAccounts(), loadOverview(), loadDueMistakes(), loadMistakeKeys()];
          if (currentTab.value === "overview") tasks.push(loadHeatmap({ forceNetwork: true }), loadTags());
          if (currentTab.value === "submissions") tasks.push(loadSubmissions({ forceRefresh: true }));
          if (currentTab.value === "mistakes") tasks.push(loadMistakes());
          await Promise.allSettled(tasks);
        } catch (e) {
          // ignore
        }
        return;
      }
      isVerifying.value[platform] = true;
      try {
        showToast(`正在同步 ${getPlatformName(platform)} 所有账号...`, "info");
        const res = await apiFetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ platform }),
          timeoutMs: 180000
        });
        const data = await res.json();
        const syncMsg = data.message || data.data?.message;
        if (!res.ok || data.success === false) {
          showToast(`${getPlatformName(platform)} 同步未完成: ${syncMsg || "请求失败"}`, "error");
        } else {
          showToast(`${getPlatformName(platform)} 同步完成: ${syncMsg || "已获取最新数据"}`, "success");
        }
        invalidateHeatmapCache(true);
        invalidateSubmissionsCache();
        const tasks = [loadAccounts(), loadOverview(), loadDueMistakes(), loadMistakeKeys()];
        if (currentTab.value === "overview") tasks.push(loadHeatmap({ forceNetwork: true }), loadTags());
        if (currentTab.value === "submissions") tasks.push(loadSubmissions({ forceRefresh: true }));
        if (currentTab.value === "mistakes") tasks.push(loadMistakes());
        await Promise.allSettled(tasks);
        if (currentTab.value === "overview") {
          renderHeatmap();
          renderActiveChart();
          syncSegmentedThumbs();
        }
      } catch (e) {
        showToast("同步异常: " + e.message, "error");
      } finally {
        isVerifying.value[platform] = false;
      }
    };

    // --- Helpers ---
    const formatPollInterval = (mins) => {
      const m = parseInt(mins, 10) || 1440;
      if (m === 1440) return "每天";
      if (m > 1440 && m % 1440 === 0) return `每${m / 1440}天`;
      if (m >= 60 && m % 60 === 0) return `${m / 60}小时`;
      return `${m}分钟`;
    };

    const formatTimeAgo = (timeStr) => {
      if (!timeStr) return "";
      try {
        const parts = timeStr.trim().split(/[\s-:]+/);
        if (parts.length < 5) return timeStr;
        
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        const hour = parseInt(parts[3], 10);
        const minute = parseInt(parts[4], 10);
        const second = parts.length >= 6 ? parseInt(parts[5], 10) : 0;
        
        const subDate = new Date(year, month, day, hour, minute, second);
        const now = new Date();
        const diffMs = now.getTime() - subDate.getTime();
        const diffSec = Math.floor(diffMs / 1000);
        
        if (diffSec < 0) return timeStr;
        if (diffSec < 45) return "刚刚";
        if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分钟前`;
        if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}小时前`;
        if (diffSec < 86400 * 2) return `昨天 ${parts[3]}:${parts[4]}`;
        if (diffSec < 86400 * 3) return `前天 ${parts[3]}:${parts[4]}`;
        
        return timeStr;
      } catch (e) {
        return timeStr;
      }
    };

    const getStatusClass = (platform) => {
      const s = platformStatusMap.value[platform]?.status || "unconfigured";
      return s;
    };

    const getPlatformPillClass = (platform) => {
      const s = platformStatusMap.value[platform]?.status || "unconfigured";
      return `status-${s}`;
    };

    const getPlatformShortStatus = (platform) => {
      const info = platformStatusMap.value[platform];
      const s = info?.status || "unconfigured";
      const msg = (info?.message || "").trim();
      if (s === "ok") {
        if (!msg || /油猴|秒级|同步成功|成功同步|已连接/.test(msg)) {
          return "已连接";
        }
        return msg.length <= 10 ? msg : "已连接";
      }
      if (s === "warning") return "需检查";
      if (s === "error") return "连接异常";
      return "未配置";
    };

    // --- Draggable Phone-Style Notification Center (Local DB Only) ---
    const upcoming3dContests = computed(() => {
      const now = nowTimestamp.value || Math.floor(Date.now() / 1000);
      const threeDaysLater = now + 3 * 86400;
      return (contests.value || [])
        .filter(c => {
          const st = c.start_timestamp || 0;
          const et = st + (c.duration_seconds || 7200);
          return et > now && (now >= st || st <= threeDaysLater);
        })
        .slice()
        .sort((a, b) => (a.start_timestamp || 0) - (b.start_timestamp || 0));
    });

    const notifyTotalCount = computed(() => {
      return dueMistakesList.value.length + upcoming3dContests.value.length;
    });

    const formatContestShortTime = (startTimeStr) => {
      if (!startTimeStr) return "";
      const parts = String(startTimeStr).trim().split(/[\s]+/);
      const datePart = parts[0] || "";
      const timePart = (parts[1] || "").slice(0, 5);
      const todayStr = getLocalDateStr(0);
      const tomorrowStr = getLocalDateStr(1);
      const afterTomorrowStr = getLocalDateStr(2);
      if (datePart === todayStr) return `今天 ${timePart}`;
      if (datePart === tomorrowStr) return `明天 ${timePart}`;
      if (datePart === afterTomorrowStr) return `后天 ${timePart}`;
      return `${datePart.slice(5)} ${timePart}`;
    };

    const getContestShortPlatform = (plat) => {
      const map = {
        codeforces: "CF",
        atcoder: "AT",
        luogu: "洛谷",
        acwing: "AcWing",
        leetcode: "力扣",
        nowcoder: "牛客"
      };
      return map[plat] || (plat ? String(plat).toUpperCase() : "比赛");
    };

    const notifyBarHeadline = computed(() => {
      const dueLen = dueMistakesList.value.length;
      const cLen = upcoming3dContests.value.length;
      if (dueLen > 0) {
        return `${dueLen} 题待补刷`;
      }
      if (cLen > 0) {
        return `近 3 天 ${cLen} 场待打`;
      }
      return "近期日程与错题";
    });

    const notifyBarSubline = computed(() => {
      const dueLen = dueMistakesList.value.length;
      const list = upcoming3dContests.value;
      if (list.length > 0) {
        const nearest = list[0];
        const plat = getContestShortPlatform(nearest.platform);
        const t = formatContestShortTime(nearest.start_time);
        if (dueLen > 0) {
          return `近3天 ${list.length} 场待打 · 最近 ${plat} ${t}`;
        }
        return `最近 ${plat} · ${t} · ${nearest.name}`;
      }
      if (dueLen > 0) {
        const first = dueMistakesList.value[0];
        return `置顶: [${first.problem_id}] ${first.problem_title}`;
      }
      return "近 3 天暂无比赛 · 错题已清零";
    });

    const notifyState = ref("orb"); // 'orb' | 'bar' | 'detail'
    // 边缘锚定坐标（跨屏幕/缩放及长条<->图标伸缩全程原地稳定，彻底杜绝先缩到左边再瞬移到右边的错位）
    let savedNotifyAnchor = { sideX: "right", edgeX: 20, sideY: "bottom", edgeY: 20 };
    try {
      const rawAnchor = localStorage.getItem("oiboard_notify_anchor_v2");
      if (rawAnchor) {
        const parsed = JSON.parse(rawAnchor);
        if (
          (parsed?.sideX === "left" || parsed?.sideX === "right") &&
          (parsed?.sideY === "top" || parsed?.sideY === "bottom") &&
          typeof parsed?.edgeX === "number" &&
          typeof parsed?.edgeY === "number"
        ) {
          savedNotifyAnchor = parsed;
        }
      }
    } catch (e) {}
    const notifyAnchor = ref(savedNotifyAnchor);
    const notifyAnchorSide = computed(() => notifyAnchor.value.sideX);
    const notifyAnchorY = computed(() => notifyAnchor.value.sideY);
    const viewportSize = ref({ w: window.innerWidth, h: window.innerHeight });

    let notifyAutoHideTimer = null;
    let notifyHoverLeaveTimer = null;
    let notifyCollapseSeqTimer = null;
    let notifyHovered = false;
    let notifySuppressHoverUntilLeave = false;
    let notifyWasDragged = false;
    let notifyDragState = null;

    const canHoverDevice = () => !window.matchMedia || window.matchMedia("(hover: hover)").matches;

    const clearNotifyAutoHide = () => {
      if (notifyAutoHideTimer) {
        clearTimeout(notifyAutoHideTimer);
        notifyAutoHideTimer = null;
      }
      if (notifyHoverLeaveTimer) {
        clearTimeout(notifyHoverLeaveTimer);
        notifyHoverLeaveTimer = null;
      }
      if (notifyCollapseSeqTimer) {
        clearTimeout(notifyCollapseSeqTimer);
        notifyCollapseSeqTimer = null;
      }
    };

    const scheduleNotifyAutoHide = (delayMs = 30000) => {
      if (notifyAutoHideTimer) {
        clearTimeout(notifyAutoHideTimer);
        notifyAutoHideTimer = null;
      }
      if (notifyState.value !== "bar" || notifyHovered) {
        return;
      }
      notifyAutoHideTimer = setTimeout(() => {
        if (notifyState.value === "bar" && !notifyHovered && !notifyDragState) {
          notifyState.value = "orb";
        }
        notifyAutoHideTimer = null;
      }, delayMs);
    };

    const triggerStartupNotification = () => {
      if (!isLoggedIn.value) return;
      clearNotifyAutoHide();
      notifySuppressHoverUntilLeave = false;
      // 刷新或首次进入默认展开为通知长条，30 秒后自动收起为图标（鼠标交互优先级更高）
      notifyState.value = "bar";
      scheduleNotifyAutoHide(30000);
    };

    const collapseNotifyToOrb = () => {
      clearNotifyAutoHide();
      if (notifyHovered) {
        notifySuppressHoverUntilLeave = true;
      }
      if (notifyState.value === "detail") {
        // 先让同宽详情卡片平滑伸缩收回至通知条内，再将通知条平滑收拢为图标
        notifyState.value = "bar";
        notifyCollapseSeqTimer = setTimeout(() => {
          if (notifyState.value === "bar" && !notifyDragState) {
            notifyState.value = "orb";
          }
          notifyCollapseSeqTimer = null;
        }, 195);
      } else {
        notifyState.value = "orb";
      }
    };

    const onNotifyMouseEnter = () => {
      if (!canHoverDevice()) return;
      notifyHovered = true;
      clearNotifyAutoHide();
      if (notifyState.value === "orb" && !notifySuppressHoverUntilLeave && !notifyDragState) {
        notifyState.value = "bar";
      }
    };

    const onNotifyMouseLeave = () => {
      if (!canHoverDevice()) return;
      notifyHovered = false;
      notifySuppressHoverUntilLeave = false;
      clearNotifyAutoHide();
      // 鼠标移出立即触发收回（无需等待初始 30 秒倒计时），仅保留 180ms 防边缘抖动
      if (notifyState.value === "bar" && !notifyDragState) {
        notifyHoverLeaveTimer = setTimeout(() => {
          if (notifyState.value === "bar" && !notifyHovered && !notifyDragState) {
            notifyState.value = "orb";
          }
          notifyHoverLeaveTimer = null;
        }, 180);
      }
    };

    const completeDueMistakeFromNotify = async (item) => {
      await recordMistakeReview(item);
    };

    const clampNotifyEdge = (anchor) => {
      const vw = viewportSize.value.w || window.innerWidth;
      const vh = viewportSize.value.h || window.innerHeight;
      const margin = 12;
      const sideX = anchor.sideX === "left" ? "left" : "right";
      const sideY = anchor.sideY === "top" ? "top" : "bottom";
      // 手机竖屏（<768px）底部留出底部导航栏安全区，避免悬浮通知遮挡导航按钮
      const minEdgeY = (vw < 768 && sideY === "bottom") ? 76 : margin;
      const barW = Math.min(352, vw - margin * 2);
      const maxEdgeX = Math.max(margin, vw - barW - margin);
      const maxEdgeY = Math.max(minEdgeY, vh - 46 - margin);
      return {
        sideX,
        sideY,
        edgeX: Math.round(Math.max(margin, Math.min(anchor.edgeX, maxEdgeX))),
        edgeY: Math.round(Math.max(minEdgeY, Math.min(anchor.edgeY, maxEdgeY)))
      };
    };

    const notifyHostStyle = computed(() => {
      const a = clampNotifyEdge(notifyAnchor.value);
      const style = {};
      if (a.sideX === "left") {
        style.left = `${a.edgeX}px`;
      } else {
        style.right = `${a.edgeX}px`;
      }
      if (a.sideY === "top") {
        style.top = `${a.edgeY}px`;
      } else {
        style.bottom = `${a.edgeY}px`;
      }
      return style;
    });

    const notifyPopoverStyle = computed(() => {
      const a = clampNotifyEdge(notifyAnchor.value);
      const style = {};
      if (a.sideY === "bottom") {
        style.bottom = "calc(100% + 10px)";
      } else {
        style.top = "calc(100% + 10px)";
      }
      if (a.sideX === "right") {
        style.right = "0px";
      } else {
        style.left = "0px";
      }
      return style;
    });

    const startNotifyDrag = (clientX, clientY, isTouch) => {
      const host = document.getElementById("notify-widget-host");
      if (!host) return;
      const rect = host.getBoundingClientRect();
      notifyWasDragged = false;
      notifyDragState = {
        startX: clientX,
        startY: clientY,
        originLeft: rect.left,
        originTop: rect.top,
        width: rect.width,
        height: rect.height
      };

      const onMove = (ev) => {
        if (!notifyDragState) return;
        const pt = isTouch ? (ev.touches && ev.touches[0]) : ev;
        if (!pt) return;
        const dx = pt.clientX - notifyDragState.startX;
        const dy = pt.clientY - notifyDragState.startY;
        if (!notifyWasDragged && Math.hypot(dx, dy) > 5) {
          notifyWasDragged = true;
          clearNotifyAutoHide();
        }
        if (notifyWasDragged) {
          if (ev.cancelable) ev.preventDefault();
          const vw = viewportSize.value.w || window.innerWidth;
          const vh = viewportSize.value.h || window.innerHeight;
          const margin = 12;
          const newLeft = Math.max(margin, Math.min(notifyDragState.originLeft + dx, vw - notifyDragState.width - margin));
          const newTop = Math.max(margin, Math.min(notifyDragState.originTop + dy, vh - notifyDragState.height - margin));
          const centerX = newLeft + notifyDragState.width / 2;
          const centerY = newTop + notifyDragState.height / 2;
          const sideX = centerX >= vw / 2 ? "right" : "left";
          const sideY = centerY >= vh / 2 ? "bottom" : "top";
          const edgeX = sideX === "right" ? Math.round(vw - (newLeft + notifyDragState.width)) : Math.round(newLeft);
          const edgeY = sideY === "bottom" ? Math.round(vh - (newTop + notifyDragState.height)) : Math.round(newTop);
          notifyAnchor.value = { sideX, edgeX: Math.max(margin, edgeX), sideY, edgeY: Math.max(margin, edgeY) };
        }
      };

      const onEnd = () => {
        if (isTouch) {
          window.removeEventListener("touchmove", onMove);
          window.removeEventListener("touchend", onEnd);
          window.removeEventListener("touchcancel", onEnd);
        } else {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onEnd);
        }
        if (notifyWasDragged && notifyAnchor.value) {
          notifyAnchor.value = clampNotifyEdge(notifyAnchor.value);
          try {
            localStorage.setItem("oiboard_notify_anchor_v2", JSON.stringify(notifyAnchor.value));
          } catch (e) {}
          setTimeout(() => { notifyWasDragged = false; }, 60);
        }
        notifyDragState = null;
        if (!notifyHovered && notifyState.value === "bar") {
          notifyHoverLeaveTimer = setTimeout(() => {
            if (notifyState.value === "bar" && !notifyHovered && !notifyDragState) {
              notifyState.value = "orb";
            }
            notifyHoverLeaveTimer = null;
          }, 180);
        }
      };

      if (isTouch) {
        window.addEventListener("touchmove", onMove, { passive: false });
        window.addEventListener("touchend", onEnd);
        window.addEventListener("touchcancel", onEnd);
      } else {
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onEnd);
      }
    };

    const onNotifyPointerDown = (e) => {
      if (e.button !== 0) return;
      if (e.target && e.target.closest("button, a")) return;
      startNotifyDrag(e.clientX, e.clientY, false);
    };

    const onNotifyTouchStart = (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      if (e.target && e.target.closest("button, a")) return;
      startNotifyDrag(e.touches[0].clientX, e.touches[0].clientY, true);
    };

    const onNotifyShellClick = (e) => {
      if (notifyWasDragged) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      clearNotifyAutoHide();
      if (notifyState.value === "detail") {
        if (notifyHovered) {
          // 鼠标仍在通知条上时收起详情回到长条，移出后自动收回图标
          notifyState.value = "bar";
        } else {
          collapseNotifyToOrb();
        }
      } else {
        notifySuppressHoverUntilLeave = false;
        notifyState.value = "detail";
      }
    };

    const onDocumentMouseDown = (e) => {
      if (notifyState.value !== "detail") return;
      const host = document.getElementById("notify-widget-host");
      if (host && !host.contains(e.target)) {
        notifyHovered = false;
        notifySuppressHoverUntilLeave = false;
        collapseNotifyToOrb();
      }
    };

    // --- Unified Polling Engine (A1/A2/A8: in-flight guard, failure backoff, tab dispatch) ---
    const refreshCurrentUser = async (force = false) => {
      const now = Date.now();
      if (!force && (now - lastUserRefreshTime < 60000)) {
        return;
      }
      if (!token.value) return;
      try {
        const res = await apiFetch("/api/auth/me");
        if (res.ok) {
          const data = await res.json();
          if (data && data.user) {
            currentUser.value = data.user;
            localStorage.setItem("oiboard_user", JSON.stringify(data.user));
            lastUserRefreshTime = Date.now();
          }
        }
      } catch (e) {
        if (e.message === "UNAUTHORIZED") {
          resetAllUserStates();
          fetchCaptcha();
        }
      }
    };

    // --- Event-Driven SSE Engine (事件驱动实时推送，静止 0 轮询请求，变更毫秒级精准刷新) ---
    const refreshCurrentTabSoft = async () => {
      if (!isLoggedIn.value || document.hidden || isSyncing.value || isSaving.value) return;
      const tab = currentTab.value;
      const tasks = [];
      if (tab === "overview") {
        tasks.push(loadOverview(), loadHeatmap({ useCacheFirst: true }), loadTags(), loadContests(), loadDueMistakes());
      } else if (tab === "submissions") {
        tasks.push(loadSubmissions({ forceRefresh: true }), loadMistakeKeys());
      } else if (tab === "mistakes") {
        tasks.push(loadMistakes(), loadDueMistakes());
      } else if (tab === "contests") {
        tasks.push(loadContests());
      } else if (tab === "settings") {
        tasks.push(pollSettingsReadOnly());
      }
      await Promise.allSettled(tasks);
    };

    const scheduleCoalescedEventRefresh = (domain, fn, delayMs = 260) => {
      const prev = sseDomainTimers.get(domain);
      if (prev) clearTimeout(prev);
      sseDomainTimers.set(domain, setTimeout(() => {
        sseDomainTimers.delete(domain);
        if (!isLoggedIn.value) return;
        fn().catch(() => {});
      }, delayMs));
    };

    const handleServerEvent = (evt) => {
      if (!evt || !evt.type || !isLoggedIn.value) return;
      const t = evt.type;
      if (t === "submissions_updated") {
        invalidateHeatmapCache(true);
        invalidateSubmissionsCache();
        scheduleCoalescedEventRefresh("submissions", async () => {
          const tab = currentTab.value;
          const tasks = [loadOverview(), loadDueMistakes()];
          if (tab === "overview") {
            tasks.push(loadHeatmap({ forceNetwork: true }), loadTags());
          } else if (tab === "submissions") {
            tasks.push(loadSubmissions({ forceRefresh: true }), loadMistakeKeys());
          } else if (tab === "mistakes") {
            tasks.push(loadMistakes());
          }
          await Promise.allSettled(tasks);
        });
      } else if (t === "local_code_updated") {
        scheduleCoalescedEventRefresh("local_code", async () => {
          await loadOverview();
        });
      } else if (t === "mistakes_updated") {
        scheduleCoalescedEventRefresh("mistakes", async () => {
          const tasks = [loadDueMistakes(), loadMistakeKeys()];
          if (currentTab.value === "mistakes") {
            tasks.push(loadMistakes());
          }
          await Promise.allSettled(tasks);
        });
      } else if (t === "contests_updated") {
        scheduleCoalescedEventRefresh("contests", async () => {
          await loadContests();
        });
      } else if (t === "settings_updated") {
        scheduleCoalescedEventRefresh("settings", async () => {
          if (currentTab.value === "settings") {
            await pollSettingsReadOnly();
          } else {
            await loadSettings({ includeAccounts: false });
          }
        });
      }
    };

    const connectEventStream = () => {
      if (!isLoggedIn.value || !token.value || typeof EventSource === "undefined") return;
      if (eventSource && (eventSource.readyState === EventSource.OPEN || eventSource.readyState === EventSource.CONNECTING)) {
        return;
      }
      if (sseReconnectTimer) {
        clearTimeout(sseReconnectTimer);
        sseReconnectTimer = null;
      }
      try {
        const es = new EventSource(`/api/events?token=${encodeURIComponent(token.value)}`);
        eventSource = es;

        es.onopen = () => {
          sseReconnectDelay = 3000;
        };

        es.onmessage = (e) => {
          if (!e.data) return;
          try {
            const parsed = JSON.parse(e.data);
            handleServerEvent(parsed);
          } catch (err) {}
        };

        es.onerror = () => {
          if (eventSource !== es) return;
          try { es.close(); } catch (err) {}
          eventSource = null;
          if (!isLoggedIn.value || !token.value) return;
          const wait = sseReconnectDelay;
          sseReconnectDelay = Math.min(30000, sseReconnectDelay * 2);
          sseReconnectTimer = setTimeout(() => {
            sseReconnectTimer = null;
            if (!document.hidden && isLoggedIn.value) {
              connectEventStream();
            }
          }, wait);
        };
      } catch (e) {
        console.warn("[SSE] 初始化事件流失败:", e);
      }
    };

    // --- Timers and Global Event Handlers ---
    let themeTimer = null;
    let countdownTimer = null;
    let resizeDebounceTimer = null;
    let lastForegroundWakeupTime = 0;

    const onWindowResize = () => {
      viewportSize.value = { w: window.innerWidth, h: window.innerHeight };
      if (resizeDebounceTimer) {
        clearTimeout(resizeDebounceTimer);
      }
      resizeDebounceTimer = setTimeout(() => {
        if (currentTab.value === "overview") {
          renderHeatmap(true);
          renderActiveChart(true);
        }
        syncSegmentedThumbs();
      }, 150);
    };

    const onKeydown = (e) => {
      if (e.key === "Escape") {
        if (viewNoteModalOpen.value) {
          viewNoteModalOpen.value = false;
        } else if (mistakeModalOpen.value) {
          mistakeModalOpen.value = false;
        } else if (accountModalOpen.value) {
          accountModalOpen.value = false;
        } else if (notifyState.value === "detail") {
          collapseNotifyToOrb();
        }
      }
    };

    const onForegroundWakeup = () => {
      if (document.hidden) {
        lastHiddenTimestamp = Date.now();
        return;
      }
      if (!isLoggedIn.value) return;
      const now = Date.now();
      const hiddenDuration = lastHiddenTimestamp ? (now - lastHiddenTimestamp) : 0;
      lastHiddenTimestamp = 0;
      const sseDisconnected = !eventSource || eventSource.readyState !== EventSource.OPEN;
      if (sseDisconnected) {
        connectEventStream();
      }
      // 仅在长时间离开（> 60 秒）或 SSE 曾断连时做一次前台补偿同步，避免切换窗口频繁刷请求
      if ((hiddenDuration >= 60000 || sseDisconnected) && (now - lastForegroundWakeupTime >= 5000)) {
        lastForegroundWakeupTime = now;
        refreshCurrentUser(false);
        refreshCurrentTabSoft();
      }
    };

    // --- Lifecycle ---
    onMounted(async () => {
      // 初始化应用主题模式、高分屏缩放比例与毛玻璃材质
      applyTheme();
      applyUiScale();
      applyGlassMode();

      // 30 秒级自动昼夜检测定时器 (仅在 auto 模式下无感平滑切换)
      themeTimer = setInterval(() => {
        if (themePref.value === "auto") {
          const shouldBeDark = !isDaylightTime();
          if (isDark.value !== shouldBeDark) {
            applyTheme();
          }
        }
      }, 30000);

      // 分钟级比赛倒计时刷新（每 30 秒触发一次，避免 1 秒高频驱动 Vue 渲染损耗资源）
      countdownTimer = setInterval(() => {
        if (document.hidden) return;
        updateContestMetas();
      }, 30000);

      if (token.value) {
        try {
          const res = await apiFetch("/api/auth/me");
          const data = await res.json();
          currentUser.value = data.user;
          localStorage.setItem("oiboard_user", JSON.stringify(data.user));
          await reloadAllData();
          triggerStartupNotification();
        } catch (e) {
          if (e.message === "UNAUTHORIZED") {
            resetAllUserStates();
            fetchCaptcha();
          }
        } finally {
          isAuthChecking.value = false;
        }
      } else {
        isAuthChecking.value = false;
        fetchCaptcha();
      }

      window.addEventListener("resize", onWindowResize);
      window.addEventListener("keydown", onKeydown);
      document.addEventListener("mousedown", onDocumentMouseDown);
      document.addEventListener("visibilitychange", onForegroundWakeup);
      window.addEventListener("focus", onForegroundWakeup);

      nextTick(() => {
        syncSegmentedThumbs();
        updateContestMetas();
      });

      // 启动 SSE 事件驱动长连接（替代原 15 秒轮询，静止时零 HTTP 请求）
      if (isLoggedIn.value) {
        connectEventStream();
      }
    });

    onUnmounted(() => {
      if (themeTimer) clearInterval(themeTimer);
      if (countdownTimer) clearInterval(countdownTimer);
      if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      if (mistakeSearchDebounceTimer) clearTimeout(mistakeSearchDebounceTimer);
      if (mdPreviewEnhanceTimer) clearTimeout(mdPreviewEnhanceTimer);
      disconnectEventStream();
      clearNotifyAutoHide();

      window.removeEventListener("resize", onWindowResize);
      window.removeEventListener("keydown", onKeydown);
      document.removeEventListener("mousedown", onDocumentMouseDown);
      document.removeEventListener("visibilitychange", onForegroundWakeup);
      window.removeEventListener("focus", onForegroundWakeup);
    });

    // 监控图表类型切换，无缝渲染并对齐滑块
    watch(chartView, () => {
      nextTick(() => {
        syncSegmentedThumbs();
        renderActiveChart(true);
      });
    });

    // 监控平滑拟合开关切换
    watch(isCurveSmooth, () => {
      if (chartView.value === "climbing") {
        renderClimbingChart(true);
      }
    });

    // 监控比赛筛选切换
    watch([contestFilter, contestStatusFilter], () => {
      nextTick(syncSegmentedThumbs);
    });

    // 监控错题集状态与筛选切换
    watch([mistakeStatusFilter, mistakePlatformFilter, mistakeSortBy], () => {
      if (isResettingMistakeFilters) return;
      mistakePage.value = 1;
      loadMistakes().catch(e => console.error("筛选切换加载错题失败:", e));
      nextTick(syncSegmentedThumbs);
    });

    // 错题搜索防抖实时查询（输入或清空自动刷新，无需手动回车）
    watch(mistakeSearch, () => {
      if (isResettingMistakeFilters) return;
      if (mistakeSearchDebounceTimer) clearTimeout(mistakeSearchDebounceTimer);
      if (mdPreviewEnhanceTimer) clearTimeout(mdPreviewEnhanceTimer);
      mistakeSearchDebounceTimer = setTimeout(() => {
        mistakePage.value = 1;
        loadMistakes().catch(e => console.error("错题搜索失败:", e));
      }, 220);
    });

    let mdPreviewEnhanceTimer = null;
    watch([mistakeModalOpen, mistakeFormTab, () => mistakeForm.value.notes], ([open, tab]) => {
      if (open) {
        nextTick(syncSegmentedThumbs);
      }
      if (open && (tab === "preview" || tab === "split")) {
        if (mdPreviewEnhanceTimer) clearTimeout(mdPreviewEnhanceTimer);
        mdPreviewEnhanceTimer = setTimeout(() => {
          enhanceCodeBlocks("#mistake-editor-preview");
        }, 120);
      }
    });

    // 标签页切换自动静默拉取最新数据 + Hydro 顶部细进度条与定向平滑入场动效
    watch(currentTab, async (tab, oldTab) => {
      const oldIdx = TAB_ORDER.indexOf(oldTab);
      const newIdx = TAB_ORDER.indexOf(tab);
      const direction = (oldIdx === -1 || newIdx >= oldIdx) ? 1 : -1;
      triggerRouteTransition(tab, direction);
      try {
        if (tab === "overview") {
          await Promise.allSettled([loadOverview(), loadHeatmap(), loadTags(), loadContests(), loadDueMistakes()]);
          nextTick(() => {
            renderHeatmap(true);
            renderActiveChart(true);
          });
        } else if (tab === "submissions") {
          const subTasks = [loadSubmissions({ page: currentPage.value }), loadMistakeKeys()];
          if (!tagStats.value || tagStats.value.length === 0) subTasks.push(loadTags());
          await Promise.allSettled(subTasks);
        } else if (tab === "mistakes") {
          await Promise.allSettled([loadMistakes(), loadDueMistakes()]);
        } else if (tab === "contests") {
          await Promise.allSettled([loadContests()]);
        } else if (tab === "settings") {
          await Promise.allSettled([loadSettings({ includeAccounts: true })]);
        }
      } catch (err) {
        console.warn("[TabSwitch] 切换标签页加载数据异常:", err);
      } finally {
        finishRouteTransition();
        nextTick(() => {
          syncSegmentedThumbs();
        });
      }
    });

    return {
      token,
      currentUser,
      isAuthChecking,
      isLoggedIn,
      authMode,
      authForm,
      authError,
      isAuthLoading,
      showAuthPwd,
      captchaId,
      captchaImage,
      fetchCaptcha,
      pwdForm,
      isChangingPwd,
      showChangePwd,
      handleLogin,
      handleRegister,
      handleLogout,
      handleChangePassword,
      currentTab,
      activeTabIndex,
      routeProgress,
      searchKeyword,
      dateFilter,
      startDate,
      endDate,
      verdictFilter,
      selectedTag,
      availableTags,
      currentPage,
      pageSize,
      totalPages,
      submissionsTotal,
      isSubmissionsLoading,
      paginatedSubmissions,
      setDateFilter,
      resetFilters,
      overview,
      rawHeatmap,
      heatmapFilter,
      selectedHeatmapYear,
      availableHeatmapYears,
      heatmapLegendTips,
      setHeatmapYear,
      tagStats,
      submissions,
      subFilter,
      configs,
      platformStatusMap,
      isSyncing,
      isSaving,
      isSavingSystem,
      isVerifying,
      settingsForm,
      showGuide,
      toast,
      warningBanner,
      setHeatmapFilter,
      syncNow,
      toggleSprintMode,
      saveSettingsAndSync,
      saveSystemSettingsOnly,
      // Multi-Account Management exports
      accounts,
      isAccountSyncing,
      isAccountTesting,
      accountModalOpen,
      accountModalMode,
      accountForm,
      isAccountSubmitting,
      platformMetaList,
      groupedAccounts,
      getPlatformName,
      loadAccounts,
      openAddAccountModal,
      openEditAccountModal,
      handleSaveAccount,
      handleDeleteAccount,
      handleSetPrimaryAccount,
      handleSyncSingleAccount,
      handleVerifySingleAccount,
      syncPlatformManual,
      formatPollInterval,
      formatTimeAgo,
      getStatusClass,
      getPlatformPillClass,
      getPlatformShortStatus,
      // Draggable Notification Center exports
      dueMistakesList,
      upcoming3dContests,
      notifyTotalCount,
      notifyState,
      notifyAnchorSide,
      notifyAnchorY,
      notifyHostStyle,
      notifyPopoverStyle,
      notifyBarHeadline,
      notifyBarSubline,
      formatContestShortTime,
      onNotifyMouseEnter,
      onNotifyMouseLeave,
      collapseNotifyToOrb,
      completeDueMistakeFromNotify,
      onNotifyPointerDown,
      onNotifyTouchStart,
      onNotifyShellClick,
      // Theme Engine exports
      themePref,
      isDark,
      setThemePref,
      isDaylightTime,
      // UI Scale & Glass Material exports
      uiScalePref,
      setUiScalePref,
      glassMode,
      toggleGlassMode,
      // Contests exports
      contests,
      contestFilter,
      contestStatusFilter,
      contestSearch,
      isSyncingContests,
      filteredContests,
      upcomingContestsCount,
      topUpcomingContests,
      getContestStatus,
      formatContestCountdown,
      loadContests,
      syncContestsNow,
      // Analytics Workbench & Segmented Control
      chartView,
      isCurveSmooth,
      renderActiveChart,
      syncSegmentedThumbs,
      todayAcRate,
      // Mistakes Notebook exports
      mistakes,
      mistakesCounts,
      mistakeKeySet,
      mistakeStatusFilter,
      mistakePlatformFilter,
      mistakeSearch,
      mistakeTagFilter,
      mistakeSortBy,
      mistakePage,
      mistakePageSize,
      mistakeTotal,
      isMistakesLoading,
      loadMistakes,
      loadMistakeKeys,
      mistakeModalOpen,
      isMistakeEditing,
      mistakeFormTab,
      mistakeForm,
      isMistakeSaving,
      openAddToMistakesModal,
      handleSubmissionMistakeClick,
      resetMistakeFilters,
      saveMistake,
      deleteMistakeItem,
      recordMistakeReview,
      toggleMistakeMaster,
      viewNoteModalOpen,
      activeMistake,
      noteModalSize,
      noteModalCustomWidth,
      noteModalCustomHeight,
      isResizingNoteModal,
      noteBackdropPress,
      setNoteModalSize,
      toggleNoteModalMaximize,
      startNoteModalResize,
      openViewNoteModal,
      renderMarkdown,
      mistakeNotesStats,
      insertMdSyntax,
      insertOiTemplate,
      handleMdKeydown,
      // Local Agent Token exports
      isTokenCopied,
      copySyncToken
    };
  }
}).mount("#app");
