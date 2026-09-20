const { createApp, ref, onMounted, computed, nextTick, watch } = Vue;

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
    const captchaId = ref("");
    const captchaImage = ref("");

    const pwdForm = ref({ oldPassword: "", newPassword: "", confirmNewPassword: "" });
    const isChangingPwd = ref(false);

    // --- Dashboard & Platform State ---
    const overview = ref({
      stats: { total_ac: 0, total_subs: 0, today_ac: 0, today_subs: 0, streak: 0, platforms: {} },
      platforms_status: [],
      last_sync_time: "",
      climbing_curve: [],
      daily_effort: []
    });

    const currentTab = ref("overview"); // 'overview', 'submissions', 'mistakes', 'settings'
    const searchKeyword = ref("");
    const dateFilter = ref("all"); // 'all', 'today', '7d', '30d', 'year', 'custom'
    const startDate = ref("");
    const endDate = ref("");
    const verdictFilter = ref("all"); // 'all', 'AC', 'WA'
    const selectedTag = ref("");
    const currentPage = ref(1);
    const pageSize = ref(30);

    const rawHeatmap = ref([]);
    const heatmapFilter = ref("all");
    const selectedHeatmapYear = ref(new Date().getFullYear());
    const availableHeatmapYears = ref([new Date().getFullYear()]);
    const tagStats = ref([]);
    const mistakes = ref([]);
    const submissions = ref([]);
    const subFilter = ref("all");

    // --- Contests State ---
    const contests = ref([]);
    const contestFilter = ref("all"); // 'all', 'codeforces', 'atcoder', 'luogu'
    const contestStatusFilter = ref("all"); // 'all', 'BEFORE', 'CODING'
    const contestSearch = ref("");
    const isSyncingContests = ref(false);
    const nowTimestamp = ref(Math.floor(Date.now() / 1000));

    const configs = ref({
      cf_handle: "",
      luogu_uid: "",
      luogu_cookie: "",
      acwing_user_id: "",
      acwing_cookie: "",
      atcoder_handle: "",
      poll_interval_minutes: "30",
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
      { id: "luogu", name: "洛谷 (Luogu)", dotColor: "bg-emerald-500" },
      { id: "acwing", name: "AcWing", dotColor: "bg-indigo-500" }
    ];

    const groupedAccounts = computed(() => {
      const map = { codeforces: [], atcoder: [], luogu: [], acwing: [] };
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
      cf_handle: "",
      luogu_uid: "",
      luogu_cookie: "",
      acwing_user_id: "",
      acwing_cookie: "",
      atcoder_handle: "",
      poll_interval_minutes: "30",
      http_proxy: ""
    });

    const showGuide = ref(false);
    const toast = ref({ show: false, message: "", type: "success" });
    const warningBanner = ref("");

    // ECharts 实例引用
    let heatmapChart = null;
    let analyticsChart = null;
    let tagBarChart = null;
    const chartView = ref("climbing"); // 'climbing' | 'daily' | 'tags' | 'platforms'
    const isCurveSmooth = ref(true); // 累计曲线是否启用高斯核自然平滑拟合

    // --- Apple Segmented Control 物理级滑动指示器同步引擎 ---
    const syncSegmentedThumbs = () => {
      nextTick(() => {
        const controls = document.querySelectorAll(".segmented-control");
        controls.forEach(ctrl => {
          let thumb = ctrl.querySelector(".segmented-thumb");
          if (!thumb) {
            thumb = document.createElement("div");
            thumb.className = "segmented-thumb";
            ctrl.insertBefore(thumb, ctrl.firstChild);
          }
          const active = ctrl.querySelector(".segmented-item.active");
          if (active && active.offsetParent !== null) {
            thumb.style.transform = `translateX(${active.offsetLeft}px)`;
            thumb.style.width = `${active.offsetWidth}px`;
            thumb.style.height = `${active.offsetHeight}px`;
            thumb.style.opacity = "1";
          } else {
            thumb.style.opacity = "0";
          }
        });
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
          renderHeatmap();
          renderActiveChart();
        });
      }
      syncSegmentedThumbs();
    };

    const setThemePref = (mode) => {
      themePref.value = mode;
      localStorage.setItem("oiboard_theme_pref", mode);
      applyTheme();
      const desc = mode === "auto" 
        ? `自动模式 (当前为${isDark.value ? '夜间深色' : '白天浅色'})` 
        : (mode === "dark" ? "深色模式" : "浅色模式");
      showToast(`已切换为 ${desc}`, "info");
      syncSegmentedThumbs();
    };

    // --- Toast 消息提示 ---
    const showToast = (message, type = "success") => {
      toast.value = { show: true, message, type };
      setTimeout(() => {
        toast.value.show = false;
      }, 3500);
    };

    // --- 安全统一 API 请求包装器 (彻底杜绝浏览器/CDN缓存) ---
    const apiFetch = async (url, options = {}) => {
      options.headers = options.headers || {};
      options.headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
      options.headers["Pragma"] = "no-cache";
      options.headers["Expires"] = "0";
      options.cache = "no-store";
      if (token.value) {
        options.headers["Authorization"] = `Bearer ${token.value}`;
      }
      
      // 为 GET 请求自动附加当前毫秒时间戳参数，强制浏览器向服务器请求最新数据
      let reqUrl = url;
      if (!options.method || options.method.toUpperCase() === "GET") {
        const sep = reqUrl.includes("?") ? "&" : "?";
        reqUrl = `${reqUrl}${sep}_t=${Date.now()}`;
      }
      
      const res = await fetch(reqUrl, options);
      if (res.status === 401) {
        token.value = "";
        localStorage.removeItem("oiboard_token");
        localStorage.removeItem("oiboard_user");
        currentUser.value = null;
        authError.value = "登录会话已过期，请重新登录";
        throw new Error("UNAUTHORIZED");
      }
      return res;
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

    // 切换登录/注册模式时，自动刷新验证码
    watch(authMode, () => {
      authError.value = "";
      authForm.value.captcha_code = "";
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
          await reloadAllData();
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
          await reloadAllData();
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
        token.value = "";
        localStorage.removeItem("oiboard_token");
        localStorage.removeItem("oiboard_user");
        currentUser.value = null;
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

    // --- Submissions Filter & Pagination ---
    const availableTags = computed(() => {
      const set = new Set();
      (submissions.value || []).forEach(s => {
        (s.tags || []).forEach(t => set.add(t));
      });
      return Array.from(set).sort();
    });

    const filteredSubmissions = computed(() => {
      let list = submissions.value || [];

      // 1. 平台过滤
      if (subFilter.value !== "all") {
        list = list.filter(s => s.platform === subFilter.value);
      }

      // 2. 状态过滤
      if (verdictFilter.value === "AC") {
        list = list.filter(s => s.verdict === "AC");
      } else if (verdictFilter.value === "WA") {
        list = list.filter(s => s.verdict !== "AC");
      }

      // 3. 算法标签过滤
      if (selectedTag.value) {
        list = list.filter(s => (s.tags || []).includes(selectedTag.value));
      }

      // 4. 日期范围过滤
      if (dateFilter.value !== "all") {
        const today = new Date();
        const todayStr = today.toISOString().split("T")[0];

        if (dateFilter.value === "today") {
          list = list.filter(s => {
            const d = s.date || (s.submitted_at || "").split(" ")[0];
            return d === todayStr;
          });
        } else if (dateFilter.value === "7d") {
          const d7 = new Date();
          d7.setDate(today.getDate() - 7);
          const d7Str = d7.toISOString().split("T")[0];
          list = list.filter(s => {
            const d = s.date || (s.submitted_at || "").split(" ")[0];
            return d && d >= d7Str;
          });
        } else if (dateFilter.value === "30d") {
          const d30 = new Date();
          d30.setDate(today.getDate() - 30);
          const d30Str = d30.toISOString().split("T")[0];
          list = list.filter(s => {
            const d = s.date || (s.submitted_at || "").split(" ")[0];
            return d && d >= d30Str;
          });
        } else if (dateFilter.value === "year") {
          const yStr = `${today.getFullYear()}-01-01`;
          list = list.filter(s => {
            const d = s.date || (s.submitted_at || "").split(" ")[0];
            return d && d >= yStr;
          });
        } else if (dateFilter.value === "custom") {
          if (startDate.value) {
            list = list.filter(s => {
              const d = s.date || (s.submitted_at || "").split(" ")[0];
              return !d || d >= startDate.value;
            });
          }
          if (endDate.value) {
            list = list.filter(s => {
              const d = s.date || (s.submitted_at || "").split(" ")[0];
              return !d || d <= endDate.value;
            });
          }
        }
      }

      // 5. 关键词即时搜索
      if (searchKeyword.value.trim()) {
        const kw = searchKeyword.value.trim().toLowerCase();
        list = list.filter(s => 
          (s.problem_id && s.problem_id.toLowerCase().includes(kw)) ||
          (s.problem_title && s.problem_title.toLowerCase().includes(kw)) ||
          (s.code_language && s.code_language.toLowerCase().includes(kw)) ||
          (s.date && s.date.includes(kw)) ||
          (s.submitted_at && s.submitted_at.includes(kw)) ||
          (s.tags && s.tags.some(t => t.toLowerCase().includes(kw)))
        );
      }
      return list;
    });

    const totalPages = computed(() => {
      return Math.ceil(filteredSubmissions.value.length / pageSize.value) || 1;
    });

    const paginatedSubmissions = computed(() => {
      const start = (currentPage.value - 1) * pageSize.value;
      return filteredSubmissions.value.slice(start, start + pageSize.value);
    });

    const setSubFilter = (p) => {
      subFilter.value = p;
      currentPage.value = 1;
      nextTick(syncSegmentedThumbs);
    };

    const setDateFilter = (preset) => {
      dateFilter.value = preset;
      currentPage.value = 1;
      nextTick(syncSegmentedThumbs);
    };

    const resetFilters = () => {
      dateFilter.value = "all";
      startDate.value = "";
      endDate.value = "";
      subFilter.value = "all";
      verdictFilter.value = "all";
      selectedTag.value = "";
      searchKeyword.value = "";
      currentPage.value = 1;
      nextTick(syncSegmentedThumbs);
    };

    // --- Contest Computed & Helpers ---
    const getContestStatus = (c) => {
      const now = nowTimestamp.value;
      const st = c.start_timestamp;
      const dur = c.duration_seconds || 7200;
      const et = st + dur;
      if (now < st) return "BEFORE";
      if (now < et) return "CODING";
      return "FINISHED";
    };

    const formatContestCountdown = (c) => {
      const now = nowTimestamp.value;
      const st = c.start_timestamp;
      const dur = c.duration_seconds || 7200;
      const et = st + dur;

      if (now < st) {
        const diff = st - now;
        const days = Math.floor(diff / 86400);
        const hours = Math.floor((diff % 86400) / 3600);
        const mins = Math.floor((diff % 3600) / 60);
        const secs = diff % 60;
        if (days > 0) {
          return `还有 ${days} 天 ${hours} 小时 ${mins} 分`;
        } else if (hours > 0) {
          return `还有 ${hours} 小时 ${mins} 分 ${secs} 秒`;
        } else {
          return `还有 ${mins} 分 ${secs} 秒`;
        }
      } else if (now < et) {
        const remaining = et - now;
        const hours = Math.floor(remaining / 3600);
        const mins = Math.floor((remaining % 3600) / 60);
        const secs = remaining % 60;
        if (hours > 0) {
          return `进行中 (剩余 ${hours}小时${mins}分)`;
        } else {
          return `进行中 (剩余 ${mins}分${secs}秒)`;
        }
      } else {
        return "已结束";
      }
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
      const ac = overview.value.stats?.today_ac || 0;
      if (subs <= 0) return 0;
      return Math.min(100, Math.round((ac / subs) * 100));
    });

    // --- Data Loaders (绑定当前用户) ---
    let lastKnownTotalSubs = -1;
    let lastKnownSyncTime = "";

    const loadOverview = async () => {
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
              today_subs: data.stats.today_subs || 0,
              streak: data.stats.streak || 0,
              platforms: data.stats.platforms || {}
            },
            platforms_status: data.platforms_status || [],
            last_sync_time: newSync || overview.value.last_sync_time || "",
            climbing_curve: data.climbing_curve || [],
            daily_effort: data.daily_effort || []
          };

          if (currentTab.value === "overview") {
            nextTick(() => {
              renderActiveChart();
            });
          }

          lastKnownTotalSubs = newTotal;
          lastKnownSyncTime = newSync;

          // 核心实时联动：若总提交数或同步时间更新（且非首次初始化），即刻静默更新热力图与标签分布
          if (prevTotal !== -1 && (prevTotal !== newTotal || (newSync && prevSync !== newSync))) {
            loadHeatmap();
            loadTags();
          }
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
          warningBanner.value = "部分平台连接存在告警，请在平台设置中检查账号凭证与网络连接。";
        } else {
          warningBanner.value = "";
        }
      } catch (e) {
        console.error("加载 Overview 失败:", e);
      }
    };

    const loadHeatmap = async () => {
      try {
        const res = await apiFetch(`/api/stats/heatmap?platform=${heatmapFilter.value}&year=${selectedHeatmapYear.value}`);
        const data = await res.json();
        rawHeatmap.value = data.heatmap || [];
        if (data.available_years && data.available_years.length > 0) {
          availableHeatmapYears.value = data.available_years;
        }
        if (data.year) {
          selectedHeatmapYear.value = data.year;
        }
        await nextTick();
        renderHeatmap();
      } catch (e) {
        console.error("加载 Heatmap 失败:", e);
      }
    };

    const loadTags = async () => {
      try {
        const res = await apiFetch("/api/stats/tags");
        const data = await res.json();
        tagStats.value = data.tags || [];
        renderTagBarChart();
      } catch (e) {
        console.error("加载 Tag 统计失败:", e);
      }
    };

    const loadMistakes = async () => {
      try {
        const res = await apiFetch("/api/stats/mistakes?limit=50");
        const data = await res.json();
        mistakes.value = data.mistakes || [];
      } catch (e) {
        console.error("加载错题集失败:", e);
      }
    };

    const loadSubmissions = async () => {
      try {
        const res = await apiFetch("/api/stats/submissions?limit=2000");
        const data = await res.json();
        submissions.value = data.submissions || [];
      } catch (e) {
        console.error("加载提交记录流失败:", e);
      }
    };

    const loadContests = async () => {
      try {
        const res = await apiFetch("/api/contests?platform=all");
        const data = await res.json();
        contests.value = data.contests || [];
      } catch (e) {
        console.error("加载比赛日程失败:", e);
      }
    };

    const syncContestsNow = async () => {
      isSyncingContests.value = true;
      try {
        const res = await apiFetch("/api/contests/sync", { method: "POST" });
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

    const loadSettings = async () => {
      try {
        const res = await apiFetch("/api/settings");
        const data = await res.json();
        configs.value = data.configs || {};
        platformStatusMap.value = data.status || {};

        settingsForm.value = {
          cf_handle: configs.value.cf_handle || "",
          luogu_uid: configs.value.luogu_uid || "",
          luogu_cookie: configs.value.luogu_cookie || "",
          acwing_user_id: configs.value.acwing_user_id || "",
          acwing_cookie: configs.value.acwing_cookie || "",
          atcoder_handle: configs.value.atcoder_handle || "",
          poll_interval_minutes: configs.value.poll_interval_minutes || "30",
          http_proxy: configs.value.http_proxy || "",
        };
        await loadAccounts();
      } catch (e) {
        console.error("加载设置失败:", e);
      }
    };

    const reloadAllData = async () => {
      if (!isLoggedIn.value) return;
      await Promise.all([loadOverview(), loadHeatmap(), loadTags(), loadMistakes(), loadSubmissions(), loadSettings(), loadContests()]);
      await nextTick();
      syncSegmentedThumbs();
      if (currentTab.value === "overview") {
        renderHeatmap();
        renderActiveChart();
      }
    };

    // --- ECharts 渲染系统 (Apple Pro 调色 + 1:1 自适应纯正方形热力图) ---
    const renderHeatmap = () => {
      const chartDom = document.getElementById("heatmap-chart");
      if (!chartDom) return;

      const outer = chartDom.parentElement;
      const outerWidth = outer ? outer.clientWidth : 900;

      // 根据可用容器宽度自适应计算 1:1 正方形单元格物理尺寸 (13px ~ 22px)
      let cellSize = Math.floor((outerWidth - 65) / 53.5);
      if (cellSize < 13) cellSize = 13;
      if (cellSize > 22) cellSize = 22;

      // 根据计算得到的动态单元格尺寸精确确定图表内容宽高，配合 margin: 0 auto 在宽屏上完美居中，窄屏上平滑滑动
      const contentWidth = Math.ceil(cellSize * 54 + 48);
      const contentHeight = cellSize * 7 + 50;

      chartDom.style.width = `${contentWidth}px`;
      chartDom.style.height = `${contentHeight}px`;

      let chart = echarts.getInstanceByDom(chartDom);
      if (!chart) {
        chart = echarts.init(chartDom);
      }
      heatmapChart = chart;
      chart.clear();

      const dark = isDark.value;
      const targetYear = selectedHeatmapYear.value || new Date().getFullYear();
      const startDateStr = `${targetYear}-01-01`;
      const endDateStr = `${targetYear}-12-31`;

      // heatMapData: [date, count (total subs), unique_ac (passed problems)]
      const heatMapData = (rawHeatmap.value || [])
        .filter(item => item.date && item.date.startsWith(`${targetYear}`))
        .map(item => [item.date, item.count, item.unique_ac || 0]);

      const option = {
        tooltip: {
          trigger: "item",
          appendToBody: true,
          confine: false,
          padding: [9, 14],
          backgroundColor: dark ? "rgba(20, 20, 22, 0.96)" : "rgba(255, 255, 255, 0.96)",
          borderColor: dark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.08)",
          borderWidth: 1,
          textStyle: {
            color: dark ? "#f5f5f7" : "#1d1d1f",
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
            fontSize: 12
          },
          extraCssText: "backdrop-filter: blur(24px) saturate(180%); -webkit-backdrop-filter: blur(24px) saturate(180%); border-radius: 12px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25); z-index: 99999;",
          formatter: function (p) {
            const date = p.value[0];
            const subs = p.value[1] || 0;
            const ac = p.value[2] || 0;
            let html = `<div class="font-sans text-xs font-semibold" style="color: ${dark ? '#a1a1a6' : '#6e6e73'}">${date}</div>`;
            html += `<div class="text-xs font-bold mt-1 font-sans" style="color: ${dark ? '#2997ff' : '#0071e3'};">提交: ${subs} 次</div>`;
            if (ac > 0) {
              html += `<div class="text-xs font-bold mt-0.5 font-sans" style="color: ${dark ? '#30d158' : '#34c759'};">通过: ${ac} 题</div>`;
            }
            return html;
          }
        },
        visualMap: {
          show: false,
          min: 1,
          max: 10,
          inRange: {
            color: dark 
              ? ["#0a2e4a", "#0f5a8a", "#1a85cc", "#2997ff"]
              : ["#bae6fd", "#38bdf8", "#0284c7", "#0071e3"]
          },
          outOfRange: {
            color: dark ? "#161618" : "#ebedf0"
          }
        },
        calendar: {
          top: 24,
          left: 28,
          cellSize: [cellSize, cellSize], /* 动态正方形单元格 [cellSize, cellSize] 严格 1:1 */
          range: [startDateStr, endDateStr],
          itemStyle: {
            color: dark ? "#161618" : "#ebedf0",
            borderColor: dark ? "#000000" : "#ffffff",
            borderWidth: 2,
            borderRadius: Math.max(2, Math.round(cellSize * 0.18))
          },
          splitLine: { show: false },
          yearLabel: { show: false },
          dayLabel: {
            firstDay: 1,
            nameMap: ["日", "一", "二", "三", "四", "五", "六"],
            color: dark ? "#6e6e73" : "#86868b",
            fontSize: 10,
            fontFamily: "JetBrains Mono"
          },
          monthLabel: {
            color: dark ? "#a1a1a6" : "#6e6e73",
            fontSize: 11,
            fontFamily: "JetBrains Mono"
          }
        },
        series: [{
          type: "heatmap",
          coordinateSystem: "calendar",
          data: heatMapData
        }]
      };

      chart.setOption(option, true);
      chart.resize();
    };

    // 1. 累计解题成长曲线 (Unique AC Progress Curve) - 数据与顶部 total_ac 严格一致
    const renderClimbingChart = () => {
      const chartDom = document.getElementById("analytics-chart");
      if (!chartDom) return;

      let chart = echarts.getInstanceByDom(chartDom);
      if (!chart) {
        chart = echarts.init(chartDom);
      }
      analyticsChart = chart;
      chart.clear();

      const dark = isDark.value;
      const rawCurve = overview.value.climbing_curve || [];
      
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
        const todayStr = new Date().toISOString().slice(0, 10);
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
        tooltip: {
          trigger: "axis",
          axisPointer: {
            type: "line",
            lineStyle: {
              color: dark ? "rgba(255, 255, 255, 0.2)" : "rgba(0, 0, 0, 0.15)",
              width: 1,
              type: "dashed"
            }
          },
          padding: [8, 14],
          backgroundColor: dark ? "rgba(20, 20, 22, 0.95)" : "rgba(255, 255, 255, 0.95)",
          borderColor: dark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.08)",
          textStyle: {
            color: dark ? "#f5f5f7" : "#1d1d1f",
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
            fontSize: 12
          },
          extraCssText: "backdrop-filter: blur(24px) saturate(180%); border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,0.25);",
          formatter: function (params) {
            const p = params[0];
            const idx = p.dataIndex;
            const realVal = values[idx]; // 始终显示真实的整数累计通过量
            const newCount = newAcs[idx] || 0;
            let html = `<div class="font-sans text-xs font-semibold" style="color: ${dark ? '#a1a1a6' : '#6e6e73'}">${p.name}</div>`;
            html += `<div class="text-xs font-bold mt-1 font-sans" style="color:${dark ? '#2997ff' : '#0071e3'}">累计通过: ${realVal} 题</div>`;
            if (newCount > 0) {
              html += `<div class="text-xs font-medium mt-0.5 font-sans" style="color:${dark ? '#30d158' : '#34c759'}">当日新增: +${newCount} 题</div>`;
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
          axisLine: { lineStyle: { color: dark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.08)" } },
          axisLabel: { 
            color: dark ? "#86868b" : "#86868b", 
            fontSize: 10, 
            fontFamily: "JetBrains Mono",
            formatter: (val) => val.slice(2) // YY-MM-DD
          }
        },
        yAxis: {
          type: "value",
          min: yMin,
          ...(yMax !== undefined ? { max: yMax } : {}),
          minInterval: 1,
          splitLine: { lineStyle: { color: dark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)" } },
          axisLabel: { color: dark ? "#86868b" : "#86868b", fontSize: 10, fontFamily: "JetBrains Mono" }
        },
        series: [{
          name: "累计通过题目",
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
    const renderDailyEffortChart = () => {
      const chartDom = document.getElementById("analytics-chart");
      if (!chartDom) return;

      let chart = echarts.getInstanceByDom(chartDom);
      if (!chart) {
        chart = echarts.init(chartDom);
      }
      analyticsChart = chart;
      chart.clear();

      const dark = isDark.value;
      const rawDaily = overview.value.daily_effort || [];

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
        const todayStr = new Date().toISOString().slice(0, 10);
        dates = [todayStr.slice(2)];
        fullDates = [todayStr];
        acList = [overview.value.stats?.today_ac || 0];
        nonAcList = [Math.max(0, (overview.value.stats?.today_subs || 0) - (overview.value.stats?.today_ac || 0))];
        totalList = [overview.value.stats?.today_subs || 0];
      }

      const option = {
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "shadow" },
          padding: [8, 14],
          backgroundColor: dark ? "rgba(20, 20, 22, 0.95)" : "rgba(255, 255, 255, 0.95)",
          borderColor: dark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.08)",
          textStyle: {
            color: dark ? "#f5f5f7" : "#1d1d1f",
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif'
          },
          extraCssText: "backdrop-filter: blur(24px) saturate(180%); border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,0.25);",
          formatter: function (params) {
            const idx = params[0]?.dataIndex ?? 0;
            const date = fullDates[idx] || "";
            const ac = acList[idx] || 0;
            const total = totalList[idx] || 0;
            let html = `<div class="font-sans text-xs font-semibold" style="color: ${dark ? '#a1a1a6' : '#6e6e73'}">${date}</div>`;
            html += `<div class="text-xs font-bold mt-1 font-sans" style="color: ${dark ? '#2997ff' : '#0071e3'}">通过题目: ${ac} 题</div>`;
            html += `<div class="text-xs font-medium mt-0.5 font-sans" style="color: ${dark ? '#a1a1a6' : '#6e6e73'}">提交次数: ${total} 次</div>`;
            if (total > 0) {
              const rate = Math.round((ac / total) * 100);
              html += `<div class="text-[11px] font-mono mt-0.5" style="color: ${dark ? '#30d158' : '#34c759'}">通过率: ${rate}%</div>`;
            }
            return html;
          }
        },
        legend: {
          top: 8,
          right: 20,
          textStyle: {
            color: dark ? "#a1a1a6" : "#6e6e73",
            fontSize: 11,
            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif'
          },
          data: ["通过题目 (AC)", "未通过提交"]
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
          axisLine: { lineStyle: { color: dark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.08)" } },
          axisLabel: { color: dark ? "#86868b" : "#86868b", fontSize: 10, fontFamily: "JetBrains Mono" }
        },
        yAxis: {
          type: "value",
          splitLine: { lineStyle: { color: dark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)" } },
          axisLabel: { color: dark ? "#86868b" : "#86868b", fontSize: 10, fontFamily: "JetBrains Mono" }
        },
        series: [
          {
            name: "通过题目 (AC)",
            type: "bar",
            stack: "total",
            barMaxWidth: 16,
            itemStyle: {
              borderRadius: [0, 0, 0, 0],
              color: dark ? "#2997ff" : "#0071e3"
            },
            data: acList
          },
          {
            name: "未通过提交",
            type: "bar",
            stack: "total",
            barMaxWidth: 16,
            itemStyle: {
              borderRadius: [3, 3, 0, 0],
              color: dark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.12)"
            },
            data: nonAcList
          }
        ]
      };

      chart.setOption(option, true);
      chart.resize();
    };

    // 3. 算法标签掌握分布
    const renderTagBarChart = () => {
      const chartDom = document.getElementById("analytics-chart");
      if (!chartDom) return;

      let chart = echarts.getInstanceByDom(chartDom);
      if (!chart) {
        chart = echarts.init(chartDom);
      }
      analyticsChart = chart;
      chart.clear();

      const dark = isDark.value;
      const topTags = (tagStats.value || []).slice(0, 10).reverse();
      const categories = topTags.map(t => t.tag);
      const acData = topTags.map(t => t.ac_count);

      const option = {
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "shadow" },
          padding: [8, 14],
          backgroundColor: dark ? "rgba(20, 20, 22, 0.95)" : "rgba(255, 255, 255, 0.95)",
          borderColor: dark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.08)",
          textStyle: {
            color: dark ? "#f5f5f7" : "#1d1d1f",
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif'
          },
          extraCssText: "backdrop-filter: blur(24px) saturate(180%); border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,0.25);",
          formatter: function (params) {
            const p = params[0];
            const col = dark ? '#2997ff' : '#0071e3';
            return `<div class="font-sans text-xs font-semibold" style="color: ${dark ? '#a1a1a6' : '#6e6e73'}">${p.name}</div><div class="text-xs font-bold mt-1 font-sans" style="color:${col}">通过题数: ${p.value} 题</div>`;
          }
        },
        grid: {
          left: "3%",
          right: "6%",
          bottom: "8%",
          top: "6%",
          containLabel: true
        },
        xAxis: {
          type: "value",
          splitLine: { lineStyle: { color: dark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)" } },
          axisLabel: { color: dark ? "#86868b" : "#86868b", fontSize: 10, fontFamily: "JetBrains Mono" }
        },
        yAxis: {
          type: "category",
          data: categories,
          axisLine: { lineStyle: { color: dark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.08)" } },
          axisLabel: { color: dark ? "#f5f5f7" : "#1d1d1f", fontSize: 11, fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif' }
        },
        series: [{
          name: "通过题数",
          type: "bar",
          data: acData,
          itemStyle: {
            borderRadius: [0, 6, 6, 0],
            color: new echarts.graphic.LinearGradient(0, 0, 1, 0, dark ? [
              { offset: 0, color: "rgba(41, 151, 255, 0.25)" },
              { offset: 1, color: "#2997ff" }
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
    const renderPlatformPie = () => {
      const chartDom = document.getElementById("analytics-chart");
      if (!chartDom) return;

      let chart = echarts.getInstanceByDom(chartDom);
      if (!chart) {
        chart = echarts.init(chartDom);
      }
      analyticsChart = chart;
      chart.clear();

      const dark = isDark.value;
      const pData = overview.value.stats.platforms || {};
      const data = [
        { value: pData.codeforces?.ac || 0, name: "Codeforces", itemStyle: { color: dark ? "#2997ff" : "#0071e3" } },
        { value: pData.atcoder?.ac || 0, name: "AtCoder", itemStyle: { color: dark ? "#bf5af2" : "#af52de" } },
        { value: pData.luogu?.ac || 0, name: "洛谷", itemStyle: { color: dark ? "#30d158" : "#34c759" } },
        { value: pData.acwing?.ac || 0, name: "AcWing", itemStyle: { color: dark ? "#ff9f0a" : "#ff9500" } }
      ].filter(d => d.value > 0);

      const option = {
        tooltip: {
          trigger: "item",
          formatter: "{b}: {c} 题 ({d}%)",
          backgroundColor: dark ? "rgba(20, 20, 22, 0.95)" : "rgba(255, 255, 255, 0.95)",
          borderColor: dark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.08)",
          textStyle: {
            color: dark ? "#f5f5f7" : "#1d1d1f",
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif'
          },
          extraCssText: "backdrop-filter: blur(24px) saturate(180%); border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,0.25);"
        },
        legend: {
          bottom: "6%",
          left: "center",
          textStyle: { color: dark ? "#a1a1a6" : "#6e6e73", fontSize: 11, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }
        },
        series: [{
          name: "通过题量分布",
          type: "pie",
          radius: ["45%", "70%"],
          center: ["50%", "48%"],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 8,
            borderColor: dark ? "#000000" : "#ffffff",
            borderWidth: 3
          },
          label: { show: false },
          emphasis: {
            label: {
              show: true,
              fontSize: 14,
              fontWeight: "bold",
              color: dark ? "#fff" : "#1d1d1f"
            }
          },
          data: data.length ? data : [{ value: 0, name: "暂无数据", itemStyle: { color: dark ? "#2c2c2e" : "#e2e8f0" } }]
        }]
      };

      chart.setOption(option, true);
      chart.resize();
    };

    const renderActiveChart = () => {
      if (chartView.value === "climbing") {
        renderClimbingChart();
      } else if (chartView.value === "daily") {
        renderDailyEffortChart();
      } else if (chartView.value === "tags") {
        renderTagBarChart();
      } else if (chartView.value === "platforms") {
        renderPlatformPie();
      }
    };

    // --- Platform & Sync Actions ---
    const setHeatmapFilter = (p) => {
      heatmapFilter.value = p;
      loadHeatmap();
      nextTick(syncSegmentedThumbs);
    };

    const setHeatmapYear = (yr) => {
      selectedHeatmapYear.value = yr;
      loadHeatmap();
      nextTick(syncSegmentedThumbs);
    };

    const syncNow = async (platform = "all") => {
      isSyncing.value = true;
      try {
        const res = await apiFetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ platform })
        });
        const data = await res.json();
        if (data.data?.synced_at) {
          overview.value.last_sync_time = data.data.synced_at;
        }
        if (data.success) {
          showToast("全平台数据同步完成！", "success");
        } else {
          showToast("部分平台同步未成功，请检查状态", "error");
        }
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
        const regularMins = configs.value.poll_interval_minutes || "30";
        showToast(next === "true" ? "已开启刷题冲刺模式 (5分钟轮询)" : `已切换为日常模式 (${regularMins}分钟轮询)`, "success");
      } catch (e) {
        showToast("切换模式失败", "error");
      }
    };

    const verifyPlatform = async (platform) => {
      isVerifying.value[platform] = true;
      try {
        const payload = {
          platform,
          cf_handle: settingsForm.value.cf_handle,
          luogu_uid: settingsForm.value.luogu_uid,
          luogu_cookie: settingsForm.value.luogu_cookie,
          acwing_user_id: settingsForm.value.acwing_user_id,
          acwing_cookie: settingsForm.value.acwing_cookie,
          atcoder_handle: settingsForm.value.atcoder_handle,
          http_proxy: settingsForm.value.http_proxy
        };
        const res = await apiFetch("/api/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.valid) {
          showToast(data.message || "连接测试成功！", "success");
        } else {
          showToast(data.message || "连接测试失败", "error");
        }
        await Promise.all([loadSettings(), loadOverview()]);
      } catch (e) {
        showToast("测试异常: " + e.message, "error");
      } finally {
        isVerifying.value[platform] = false;
      }
    };

    const saveSystemSettingsOnly = async () => {
      const proxy = (settingsForm.value.http_proxy || "").trim();
      if (proxy && !/^(http|https|socks5|socks5h|socks4):\/\//i.test(proxy)) {
        showToast("代理地址格式错误：必须以 http:// 或 socks5:// 开头（例如 http://127.0.0.1:7890）", "error");
        return;
      }
      isSavingSystem.value = true;
      try {
        const minsStr = String(settingsForm.value.poll_interval_minutes || "30");
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
          showToast(`系统参数保存成功！日常同步间隔已更新为 ${minsStr} 分钟`, "success");
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
        showToast("代理地址格式错误：必须以 http:// 或 socks5:// 开头（例如 http://127.0.0.1:7890）", "error");
        return;
      }
      isSaving.value = true;
      try {
        const minsStr = String(settingsForm.value.poll_interval_minutes || "30");
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
          showToast("配置保存成功，正在同步最新数据...", "success");
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
      if (!confirm(`确定要移除账号 [${account.alias || account.handle}] 吗？\n注意：历史已抓取的提交记录与做题统计仍将安全保留。`)) {
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
          method: "POST"
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
        showToast(`[${account.alias || account.handle}] 同步完成: 成功获取 ${count} 条提交记录`, "success");
        await Promise.all([loadAccounts(), loadOverview(), loadSubmissions(), loadMistakes()]);
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
          })
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
      isVerifying.value[platform] = true;
      try {
        showToast(`正在同步 ${getPlatformName(platform)} 所有账号...`, "info");
        const res = await apiFetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ platform })
        });
        const data = await res.json();
        if (!res.ok || data.success === false) {
          showToast(`${getPlatformName(platform)} 同步未完成: ${data.message || "请求失败"}`, "error");
        } else {
          showToast(`${getPlatformName(platform)} 同步完成: ${data.message || "已获取最新数据"}`, "success");
        }
        await Promise.all([loadAccounts(), loadOverview(), loadSubmissions(), loadMistakes()]);
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

    // --- Lifecycle ---
    onMounted(async () => {
      // 初始化应用主题模式 (根据当前时间自动切换或读取用户设定)
      applyTheme();

      // 30 秒级自动昼夜检测定时器 (仅在 auto 模式下无感平滑切换)
      setInterval(() => {
        if (themePref.value === "auto") {
          const shouldBeDark = !isDaylightTime();
          if (isDark.value !== shouldBeDark) {
            applyTheme();
          }
        }
      }, 30000);

      // 1 秒级时间戳定时器 (仅在需要倒计时的页面跳动，后台标签页自动休眠省电)
      setInterval(() => {
        if (!document.hidden && (currentTab.value === 'contests' || currentTab.value === 'overview')) {
          nowTimestamp.value = Math.floor(Date.now() / 1000);
        }
      }, 1000);

      if (token.value) {
        try {
          const res = await apiFetch("/api/auth/me");
          const data = await res.json();
          currentUser.value = data.user;
          localStorage.setItem("oiboard_user", JSON.stringify(data.user));
          await reloadAllData();
        } catch (e) {
          if (e.message === "UNAUTHORIZED") {
            currentUser.value = null;
            localStorage.removeItem("oiboard_token");
            localStorage.removeItem("oiboard_user");
            fetchCaptcha();
          }
        } finally {
          isAuthChecking.value = false;
        }
      } else {
        isAuthChecking.value = false;
        fetchCaptcha();
      }

      window.addEventListener("resize", () => {
        if (currentTab.value === "overview") {
          renderHeatmap();
          analyticsChart && analyticsChart.resize();
        }
        syncSegmentedThumbs();
      });

      nextTick(() => {
        syncSegmentedThumbs();
      });

      // 实时后台状态轮询 (每 15 秒静默刷新当前活跃标签页数据，概览页实时更新热力图)
      setInterval(async () => {
        if (isLoggedIn.value && !document.hidden && !isSyncing.value && !isSaving.value) {
          try {
            if (currentTab.value === "overview") {
              await Promise.all([loadOverview(), loadHeatmap()]);
            } else if (currentTab.value === "submissions") {
              await loadSubmissions();
            } else if (currentTab.value === "mistakes") {
              await loadMistakes();
            } else if (currentTab.value === "contests") {
              await loadContests();
            }
          } catch (e) {}
        }
      }, 15000);
    });

    // 监控图表类型切换，无缝渲染并对齐滑块
    watch(chartView, () => {
      nextTick(() => {
        syncSegmentedThumbs();
        renderActiveChart();
      });
    });

    // 监控平滑拟合开关切换
    watch(isCurveSmooth, () => {
      if (chartView.value === "climbing") {
        renderClimbingChart();
      }
    });

    // 监控比赛筛选切换
    watch([contestFilter, contestStatusFilter], () => {
      nextTick(syncSegmentedThumbs);
    });

    // 标签页切换自动静默拉取最新数据，概览页重新加载热力图与图表，彻底告别手动硬刷新
    watch(currentTab, async (tab) => {
      if (tab === "overview") {
        await Promise.all([loadOverview(), loadHeatmap(), loadTags()]);
        nextTick(() => {
          renderHeatmap();
          renderActiveChart();
          syncSegmentedThumbs();
        });
      } else {
        if (tab === "submissions") {
          await loadSubmissions();
        } else if (tab === "mistakes") {
          await loadMistakes();
        } else if (tab === "contests") {
          await loadContests();
        } else if (tab === "settings") {
          await loadSettings();
        }
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
      captchaId,
      captchaImage,
      fetchCaptcha,
      pwdForm,
      isChangingPwd,
      handleLogin,
      handleRegister,
      handleLogout,
      handleChangePassword,
      currentTab,
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
      paginatedSubmissions,
      filteredSubmissions,
      setDateFilter,
      resetFilters,
      overview,
      rawHeatmap,
      heatmapFilter,
      selectedHeatmapYear,
      availableHeatmapYears,
      setHeatmapYear,
      tagStats,
      mistakes,
      submissions,
      subFilter,
      setSubFilter,
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
      verifyPlatform,
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
      formatTimeAgo,
      getStatusClass,
      getPlatformPillClass,
      // Theme Engine exports
      themePref,
      isDark,
      setThemePref,
      isDaylightTime,
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
      todayAcRate
    };
  }
}).mount("#app");
