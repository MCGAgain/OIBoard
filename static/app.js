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
    const authForm = ref({ username: "", password: "", confirmPassword: "" });
    const authError = ref("");
    const isAuthLoading = ref(false);

    const pwdForm = ref({ oldPassword: "", newPassword: "", confirmNewPassword: "" });
    const isChangingPwd = ref(false);

    // --- Dashboard & Platform State ---
    const overview = ref({
      stats: { total_ac: 0, total_subs: 0, today_ac: 0, today_subs: 0, streak: 0, platforms: {} },
      platforms_status: [],
      last_sync_time: ""
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
    const isVerifying = ref({ codeforces: false, luogu: false, acwing: false, atcoder: false });

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
    let tagBarChart = null;
    let platformPieChart = null;

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

    // --- Auth Actions ---
    const handleLogin = async () => {
      authError.value = "";
      if (!authForm.value.username.trim() || !authForm.value.password) {
        authError.value = "请完整填写用户名与密码";
        return;
      }
      isAuthLoading.value = true;
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: authForm.value.username.trim(),
            password: authForm.value.password
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
          authForm.value = { username: "", password: "", confirmPassword: "" };
          await reloadAllData();
        } else {
          authError.value = data.detail || data.message || "登录失败，请检查账号密码";
        }
      } catch (e) {
        if (e.message !== "UNAUTHORIZED") {
          authError.value = "网络请求失败: " + e.message;
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

      isAuthLoading.value = true;
      try {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: uname, password: pwd })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          token.value = data.token;
          localStorage.setItem("oiboard_token", data.token);
          localStorage.setItem("oiboard_user", JSON.stringify(data.user));
          currentUser.value = data.user;
          isAuthChecking.value = false;
          showToast("账户注册成功！", "success");
          authForm.value = { username: "", password: "", confirmPassword: "" };
          await reloadAllData();
        } else {
          authError.value = data.detail || data.message || "注册失败";
        }
      } catch (e) {
        if (e.message !== "UNAUTHORIZED") {
          authError.value = "网络请求异常: " + e.message;
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
    };

    const setDateFilter = (preset) => {
      dateFilter.value = preset;
      currentPage.value = 1;
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
          return `🔥 正在进行中 (剩余 ${hours}小时${mins}分)`;
        } else {
          return `🔥 正在进行中 (剩余 ${mins}分${secs}秒)`;
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

    // --- Data Loaders (绑定当前用户) ---
    const loadOverview = async () => {
      try {
        const res = await apiFetch("/api/stats/overview");
        const data = await res.json();
        overview.value = data;
        
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
      } catch (e) {
        console.error("加载设置失败:", e);
      }
    };

    const reloadAllData = async () => {
      if (!isLoggedIn.value) return;
      await Promise.all([loadOverview(), loadHeatmap(), loadTags(), loadMistakes(), loadSubmissions(), loadSettings(), loadContests()]);
      await nextTick();
      if (currentTab.value === "overview") {
        renderHeatmap();
        renderTagBarChart();
        renderPlatformPie();
      }
    };

    // --- ECharts 渲染 ---
    const renderHeatmap = () => {
      const chartDom = document.getElementById("heatmap-chart");
      if (!chartDom) return;

      let chart = echarts.getInstanceByDom(chartDom);
      if (!chart) {
        chart = echarts.init(chartDom);
      }
      heatmapChart = chart;

      const targetYear = selectedHeatmapYear.value || new Date().getFullYear();
      const startDateStr = `${targetYear}-01-01`;
      const endDateStr = `${targetYear}-12-31`;

      const heatMapData = (rawHeatmap.value || [])
        .filter(item => item.date && item.date.startsWith(`${targetYear}`))
        .map(item => [item.date, item.count]);

      const option = {
        tooltip: {
          trigger: "item",
          appendToBody: true,
          confine: false,
          padding: [8, 12],
          backgroundColor: "rgba(14, 19, 31, 0.95)",
          borderColor: "rgba(56, 189, 248, 0.35)",
          borderWidth: 1,
          textStyle: {
            color: "#f8fafc",
            fontFamily: "JetBrains Mono",
            fontSize: 11
          },
          extraCssText: "backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: 8px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.7), 0 0 15px -3px rgba(6, 182, 212, 0.25); z-index: 99999;",
          formatter: function (p) {
            return `<div class="font-mono text-xs font-semibold text-slate-200">${p.value[0]}</div><div class="text-xs text-cyan-400 font-mono mt-1 font-bold">${p.value[1]} Submissions</div>`;
          }
        },
        visualMap: {
          show: false,
          min: 1,
          max: 10,
          inRange: {
            color: ["#0e3a47", "#08738a", "#06b6d4", "#38bdf8"]
          },
          outOfRange: {
            color: "#0e131f"
          }
        },
        calendar: {
          top: 26,
          left: 35,
          right: 15,
          cellSize: [13, 13],
          range: [startDateStr, endDateStr],
          itemStyle: {
            color: "#0e131f",
            borderColor: "rgba(255, 255, 255, 0.05)",
            borderWidth: 1.5,
            borderRadius: 2
          },
          splitLine: { show: false },
          yearLabel: { show: false },
          dayLabel: {
            firstDay: 1,
            nameMap: ["日", "一", "二", "三", "四", "五", "六"],
            color: "#64748b",
            fontSize: 10,
            fontFamily: "JetBrains Mono"
          },
          monthLabel: {
            color: "#94a3b8",
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

    const renderTagBarChart = () => {
      const chartDom = document.getElementById("tag-bar-chart");
      if (!chartDom) return;

      let chart = echarts.getInstanceByDom(chartDom);
      if (!chart) {
        chart = echarts.init(chartDom);
      }
      tagBarChart = chart;

      const topTags = (tagStats.value || []).slice(0, 10).reverse();
      const categories = topTags.map(t => t.tag);
      const acData = topTags.map(t => t.ac_count);

      const option = {
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "shadow" },
          className: "echarts-tooltip-dark",
          formatter: function (params) {
            const p = params[0];
            return `<div class="font-mono text-xs font-semibold">${p.name}</div><div class="text-xs text-cyan-400 mt-1">AC 题数: ${p.value}</div>`;
          }
        },
        grid: {
          left: "3%",
          right: "6%",
          bottom: "3%",
          top: "4%",
          containLabel: true
        },
        xAxis: {
          type: "value",
          splitLine: { lineStyle: { color: "rgba(255, 255, 255, 0.04)" } },
          axisLabel: { color: "#64748b", fontSize: 10, fontFamily: "JetBrains Mono" }
        },
        yAxis: {
          type: "category",
          data: categories,
          axisLine: { lineStyle: { color: "rgba(255, 255, 255, 0.1)" } },
          axisLabel: { color: "#cbd5e1", fontSize: 11, fontFamily: "Plus Jakarta Sans" }
        },
        series: [{
          name: "AC 题数",
          type: "bar",
          data: acData,
          itemStyle: {
            borderRadius: [0, 4, 4, 0],
            color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
              { offset: 0, color: "rgba(6, 182, 212, 0.3)" },
              { offset: 1, color: "#06b6d4" }
            ])
          }
        }]
      };

      chart.setOption(option, true);
      chart.resize();
    };

    const renderPlatformPie = () => {
      const chartDom = document.getElementById("platform-pie-chart");
      if (!chartDom) return;

      let chart = echarts.getInstanceByDom(chartDom);
      if (!chart) {
        chart = echarts.init(chartDom);
      }
      platformPieChart = chart;

      const pData = overview.value.stats.platforms || {};
      const data = [
        { value: pData.codeforces?.ac || 0, name: "Codeforces", itemStyle: { color: "#3b82f6" } },
        { value: pData.luogu?.ac || 0, name: "洛谷 (Luogu)", itemStyle: { color: "#f59e0b" } },
        { value: pData.acwing?.ac || 0, name: "AcWing", itemStyle: { color: "#6366f1" } }
      ].filter(d => d.value > 0);

      const option = {
        tooltip: {
          trigger: "item",
          formatter: "{b}: {c} 题 ({d}%)",
          className: "echarts-tooltip-dark"
        },
        legend: {
          bottom: "5%",
          left: "center",
          textStyle: { color: "#94a3b8", fontSize: 11, fontFamily: "JetBrains Mono" }
        },
        series: [{
          name: "通过题量分布",
          type: "pie",
          radius: ["45%", "70%"],
          center: ["50%", "45%"],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 6,
            borderColor: "#090d16",
            borderWidth: 3
          },
          label: { show: false },
          emphasis: {
            label: {
              show: true,
              fontSize: 14,
              fontWeight: "bold",
              color: "#fff"
            }
          },
          data: data.length ? data : [{ value: 0, name: "暂无数据", itemStyle: { color: "#374151" } }]
        }]
      };

      chart.setOption(option, true);
      chart.resize();
    };

    // --- Platform & Sync Actions ---
    const setHeatmapFilter = (p) => {
      heatmapFilter.value = p;
      loadHeatmap();
    };

    const setHeatmapYear = (yr) => {
      selectedHeatmapYear.value = yr;
      loadHeatmap();
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
          renderTagBarChart();
          renderPlatformPie();
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
        showToast(next === "true" ? "已开启刷题冲刺模式 (5min轮询)" : "已切换为日常模式", "success");
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
      } catch (e) {
        showToast("测试异常: " + e.message, "error");
      } finally {
        isVerifying.value[platform] = false;
      }
    };

    const saveSettingsAndSync = async () => {
      isSaving.value = true;
      try {
        const res = await apiFetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(settingsForm.value)
        });
        const data = await res.json();
        if (data.success) {
          showToast("配置保存成功，正在同步最新数据...", "success");
          currentTab.value = "overview"; // 自动平滑切回总览看板
          await syncNow("all");
        }
      } catch (e) {
        showToast("保存设置失败: " + e.message, "error");
      } finally {
        isSaving.value = false;
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
      // 启动 1 秒级全局时间戳定时器，保证比赛倒计时实时跳动
      setInterval(() => {
        nowTimestamp.value = Math.floor(Date.now() / 1000);
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
          }
        } finally {
          isAuthChecking.value = false;
        }
      } else {
        isAuthChecking.value = false;
      }

      window.addEventListener("resize", () => {
        heatmapChart && heatmapChart.resize();
        tagBarChart && tagBarChart.resize();
        platformPieChart && platformPieChart.resize();
      });
    });

    watch(currentTab, (tab) => {
      if (tab === "overview") {
        nextTick(() => {
          renderHeatmap();
          renderTagBarChart();
          renderPlatformPie();
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
      formatTimeAgo,
      getStatusClass,
      getPlatformPillClass,
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
      syncContestsNow
    };
  }
}).mount("#app");
