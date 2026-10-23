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
      daily_effort: [],
      local_code: { total_lines: 0, today_lines: 0, total_files: 0, today_files: 0, c_lines: 0, cpp_lines: 0, java_lines: 0, has_data: false }
    });

    const currentTab = ref("overview"); // 'overview', 'submissions', 'mistakes', 'settings'
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

    const rawHeatmap = ref([]);
    const heatmapFilter = ref("all");
    const selectedHeatmapYear = ref(new Date().getFullYear());
    const availableHeatmapYears = ref([new Date().getFullYear()]);
    const tagStats = ref([]);
    const mistakes = ref([]);
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
      { id: "acwing", name: "AcWing", dotColor: "bg-indigo-500" },
      { id: "leetcode", name: "力扣 (LeetCode)", dotColor: "bg-amber-500" }
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
      applyTheme();
      const desc = mode === "auto" 
        ? `自动模式 (当前为${isDark.value ? '夜间深色' : '白天浅色'})` 
        : (mode === "dark" ? "深色模式" : "浅色模式");
      showToast(`已切换为 ${desc}`, "info");
      syncSegmentedThumbs();
    };

    // --- UI Scale Engine & High-DPI Adaptation ---
    const uiScalePref = ref(localStorage.getItem("oiboard_ui_scale") || "auto");

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
      showToast(`界面缩放已设置为 ${labelMap[scale] || (scale + '%')}`, "info");
    };

    // --- Toast 消息提示 ---
    const showToast = (message, type = "success") => {
      toast.value = { show: true, message, type };
      setTimeout(() => {
        toast.value.show = false;
      }, 3500);
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
          token.value = "";
          localStorage.removeItem("oiboard_token");
          localStorage.removeItem("oiboard_user");
          currentUser.value = null;
          authError.value = "登录会话已过期，请重新登录";
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
          scheduleNextPoll(BASE_POLL_INTERVAL);
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
          scheduleNextPoll(BASE_POLL_INTERVAL);
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
        if (pollTimeoutId) {
          clearTimeout(pollTimeoutId);
          pollTimeoutId = null;
        }
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
        showToast("Token 已复制到剪贴板，请前往本地服务粘贴", "success");
        setTimeout(() => {
          isTokenCopied.value = false;
        }, 3000);
      }).catch(() => {
        showToast("复制失败，请手动在控制台查看", "error");
      });
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

      // 5. 关键词即时搜索 (支持 150ms 防抖并复用 _searchStr 预构索引)
      const kw = (debouncedSearchKeyword.value || searchKeyword.value).trim().toLowerCase();
      if (kw) {
        list = list.filter(s => s._searchStr ? s._searchStr.includes(kw) : (
          (s.problem_id && String(s.problem_id).toLowerCase().includes(kw)) ||
          (s.problem_title && s.problem_title.toLowerCase().includes(kw)) ||
          (s.code_language && s.code_language.toLowerCase().includes(kw)) ||
          (s.date && s.date.includes(kw)) ||
          (s.submitted_at && s.submitted_at.includes(kw)) ||
          (s.tags && s.tags.some(t => String(t).toLowerCase().includes(kw)))
        ));
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
      debouncedSearchKeyword.value = "";
      currentPage.value = 1;
      nextTick(syncSegmentedThumbs);
    };

    // --- Contest Computed & Helpers (A5: 集中秒级计算并以 O(1) 字典缓存，消除模板中多卡片重复函数调用) ---
    const contestMetaMap = ref({});

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
          const secs = diff % 60;
          if (days > 0) {
            countdown = `还有 ${days} 天 ${hours} 小时 ${mins} 分`;
          } else if (hours > 0) {
            countdown = `还有 ${hours} 小时 ${mins} 分 ${secs} 秒`;
          } else {
            countdown = `还有 ${mins} 分 ${secs} 秒`;
          }
        } else if (now < et) {
          status = "CODING";
          const remaining = et - now;
          const hours = Math.floor(remaining / 3600);
          const mins = Math.floor((remaining % 3600) / 60);
          const secs = remaining % 60;
          if (hours > 0) {
            countdown = `进行中 (剩余 ${hours}小时${mins}分)`;
          } else {
            countdown = `进行中 (剩余 ${mins}分${secs}秒)`;
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

    const formatContestCountdown = (c) => {
      if (contestMetaMap.value[c.id]) {
        return contestMetaMap.value[c.id].countdown;
      }
      return "已结束";
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
            daily_effort: data.daily_effort || [],
            local_code: data.local_code || { total_lines: 0, today_lines: 0, total_files: 0, today_files: 0, c_lines: 0, cpp_lines: 0, java_lines: 0, has_data: false }
          };

          if (currentTab.value === "overview") {
            nextTick(() => {
              renderActiveChart();
            });
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
          warningBanner.value = "部分平台连接存在告警，请在平台设置中检查账号凭证与网络连接。";
        } else {
          warningBanner.value = "";
        }
      } catch (e) {
        console.error("加载 Overview 失败:", e);
      }
    };

    let lastHeatmapDataStr = "";
    const loadHeatmap = async () => {
      try {
        const res = await apiFetch(`/api/stats/heatmap?platform=${heatmapFilter.value}&year=${selectedHeatmapYear.value}`);
        const data = await res.json();
        const incomingHeatmap = data.heatmap || [];
        const incomingStr = JSON.stringify(incomingHeatmap);
        const dataChanged = incomingStr !== lastHeatmapDataStr;
        if (dataChanged) {
          lastHeatmapDataStr = incomingStr;
          rawHeatmap.value = incomingHeatmap;
        }
        if (data.available_years && data.available_years.length > 0) {
          availableHeatmapYears.value = data.available_years;
        }
        if (data.year) {
          selectedHeatmapYear.value = data.year;
        }
        // 仅在数据确实发生变化且当前处于概览页时才发起非强制渲染（由哈希比对防重绘）
        if (dataChanged && currentTab.value === "overview") {
          await nextTick();
          renderHeatmap(false);
        }
      } catch (e) {
        console.error("加载 Heatmap 失败:", e);
      }
    };

    let lastTagsHash = "";
    const loadTags = async () => {
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
      }
    };

    const loadMistakeKeys = async () => {
      try {
        const res = await apiFetch("/api/mistakes/keys");
        const data = await res.json();
        mistakeKeySet.value = new Set(data.keys || []);
      } catch (e) {
        console.error("加载已收录错题Key失败:", e);
      }
    };

    const loadMistakes = async () => {
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
      } finally {
        isMistakesLoading.value = false;
      }
    };

    const openAddToMistakesModal = (subOrItem, fromMistakesList = false) => {
      isMistakeEditing.value = fromMistakesList;
      mistakeFormTab.value = "write";
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
      if (!confirm(`确定要将题目 [${item.problem_id}] ${item.problem_title} 从错题集中移除吗？`)) {
        return;
      }
      try {
        const res = await apiFetch(`/api/mistakes/${item.id}`, { method: "DELETE" });
        if (res.ok) {
          showToast("已从错题集移除", "success");
          await loadMistakes();
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
          const newCount = data.mistake.review_count;
          if (data.mistake.status === "mastered") {
            showToast(`已完成第 ${newCount} 次复习，已标记为掌握`, "success");
          } else {
            showToast(`已记录复习，下次复习: ${data.mistake.next_review_at}`, "success");
          }
          await loadMistakes();
          if (activeMistake.value && activeMistake.value.id === item.id) {
            activeMistake.value = data.mistake;
          }
        } else {
          showToast("记录失败，请重试", "error");
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
          if (data.mistake.status === "mastered") {
            showToast("已标记为掌握", "success");
          } else {
            showToast("已恢复为训练状态", "success");
          }
          await loadMistakes();
          if (activeMistake.value && activeMistake.value.id === item.id) {
            activeMistake.value = data.mistake;
          }
        }
      } catch (e) {
        console.error("切换掌握状态失败:", e);
      }
    };

    const openViewNoteModal = (item) => {
      activeMistake.value = item;
      viewNoteModalOpen.value = true;
      nextTick(() => {
        if (window.hljs) {
          document.querySelectorAll("#mistake-markdown-content pre code").forEach(el => {
            window.hljs.highlightElement(el);
          });
        }
      });
    };

    const renderMarkdown = (content) => {
      if (!content || !content.trim()) {
        return "<p class='text-[var(--text-muted)] text-xs italic'>暂无详细代码或笔记，可点击上方「编辑」补充思路与AC代码。</p>";
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

    const insertCodeSnippet = (lang = "cpp") => {
      const templates = {
        cpp: "\n```cpp\n#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    // 核心思路与解法注释\n    \n    return 0;\n}\n```\n",
        python: "\n```python\n# 核心思路与解法注释\ndef solve():\n    pass\n\nif __name__ == '__main__':\n    solve()\n```\n",
        java: "\n```java\nimport java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        // 核心思路与解法注释\n    }\n}\n```\n"
      };
      mistakeForm.value.notes += templates[lang] || templates.cpp;
    };

    const loadSubmissions = async () => {
      try {
        const res = await apiFetch("/api/stats/submissions?limit=2000");
        const data = await res.json();
        const rawSubs = data.submissions || [];
        // 预生成每条记录的小写检索缓存字符串，避免输入筛选时反复多次计算
        for (let i = 0; i < rawSubs.length; i++) {
          const s = rawSubs[i];
          const tagsStr = Array.isArray(s.tags) ? s.tags.join(" ") : (s.tags || "");
          s._searchStr = `${s.problem_id || ""} ${s.problem_title || ""} ${s.code_language || ""} ${s.date || ""} ${s.submitted_at || ""} ${tagsStr}`.toLowerCase();
        }
        submissions.value = rawSubs;
      } catch (e) {
        console.error("加载提交记录流失败:", e);
      }
    };

    const loadContests = async () => {
      try {
        const res = await apiFetch("/api/contests?platform=all");
        const data = await res.json();
        contests.value = data.contests || [];
        updateContestMetas();
      } catch (e) {
        console.error("加载比赛日程失败:", e);
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

    let settingsBaseline = {
      cf_handle: "",
      luogu_uid: "",
      luogu_cookie: "",
      acwing_user_id: "",
      acwing_cookie: "",
      atcoder_handle: "",
      poll_interval_minutes: "30",
      http_proxy: "",
      sprint_mode: "false"
    };

    const loadSettings = async () => {
      try {
        const res = await apiFetch("/api/settings");
        const data = await res.json();
        configs.value = data.configs || {};
        platformStatusMap.value = data.status || {};

        const snapshot = {
          cf_handle: configs.value.cf_handle || "",
          luogu_uid: configs.value.luogu_uid || "",
          luogu_cookie: configs.value.luogu_cookie || "",
          acwing_user_id: configs.value.acwing_user_id || "",
          acwing_cookie: configs.value.acwing_cookie || "",
          atcoder_handle: configs.value.atcoder_handle || "",
          poll_interval_minutes: configs.value.poll_interval_minutes || "30",
          http_proxy: configs.value.http_proxy || "",
          sprint_mode: configs.value.sprint_mode || "false"
        };
        settingsForm.value = { ...snapshot };
        settingsBaseline = { ...snapshot };
        await loadAccounts();
      } catch (e) {
        console.error("加载设置失败:", e);
      }
    };

    // A7-2: 设置表单脏状态检测（以基准快照 settingsBaseline 为参照，比对表单所有字段，并排查输入框聚焦）
    const isSettingsFormDirty = () => {
      const b = settingsBaseline || {};
      const s = settingsForm.value || {};
      const isProxyChanged = (s.http_proxy || "").trim() !== (b.http_proxy || "").trim();
      const isIntervalChanged = String(s.poll_interval_minutes || "30") !== String(b.poll_interval_minutes || "30");
      const isCfChanged = (s.cf_handle || "").trim() !== (b.cf_handle || "").trim();
      const isLuoguUidChanged = (s.luogu_uid || "").trim() !== (b.luogu_uid || "").trim();
      const isLuoguCookieChanged = (s.luogu_cookie || "").trim() !== (b.luogu_cookie || "").trim();
      const isAcwingUidChanged = (s.acwing_user_id || "").trim() !== (b.acwing_user_id || "").trim();
      const isAcwingCookieChanged = (s.acwing_cookie || "").trim() !== (b.acwing_cookie || "").trim();
      const isAtcoderChanged = (s.atcoder_handle || "").trim() !== (b.atcoder_handle || "").trim();
      const isSprintChanged = String(s.sprint_mode || "false") !== String(b.sprint_mode || "false");

      const activeEl = document.activeElement;
      const isInputFocused = currentTab.value === "settings" && activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.tagName === "SELECT");

      return isProxyChanged || isIntervalChanged || isCfChanged || isLuoguUidChanged || isLuoguCookieChanged || isAcwingUidChanged || isAcwingCookieChanged || isAtcoderChanged || isSprintChanged || isInputFocused;
    };

    // 静默轮询设置与多账号状态（支持独立基准脏状态保护与弹窗焦点保护）
    const pollSettingsReadOnly = async () => {
      try {
        const res = await apiFetch("/api/settings");
        const data = await res.json();
        if (data.status) {
          platformStatusMap.value = data.status;
        }

        if (data.configs) {
          configs.value = data.configs;
          // A7-2: 表单未编辑且无焦点时，同步远端最新配置并推进基线；编辑中只更新只读展示 configs，绝对不覆盖表单
          if (!isSettingsFormDirty()) {
            const incoming = {
              cf_handle: data.configs.cf_handle || "",
              luogu_uid: data.configs.luogu_uid || "",
              luogu_cookie: data.configs.luogu_cookie || "",
              acwing_user_id: data.configs.acwing_user_id || "",
              acwing_cookie: data.configs.acwing_cookie || "",
              atcoder_handle: data.configs.atcoder_handle || "",
              poll_interval_minutes: data.configs.poll_interval_minutes || "30",
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
      }
    };

    const reloadAllData = async () => {
      if (!isLoggedIn.value) return;
      await Promise.all([loadOverview(), loadHeatmap(), loadTags(), loadMistakes(), loadMistakeKeys(), loadSubmissions(), loadSettings(), loadContests()]);
      await nextTick();
      syncSegmentedThumbs();
      if (currentTab.value === "overview") {
        renderHeatmap();
        renderActiveChart();
      }
    };

    // --- ECharts 渲染系统 (Apple Pro 调色 + 1:1 自适应纯正方形热力图) ---
    let lastHeatmapRenderKey = "";
    const renderHeatmap = (force = false) => {
      const chartDom = document.getElementById("heatmap-chart");
      if (!chartDom) return;

      const outer = chartDom.parentElement;
      const outerWidth = outer ? outer.clientWidth : 900;

      // 宽屏 / 2K / 4K 高分屏下自适应放宽单元格上限（13px ~ 38px），彻底消除宽屏下右侧死白空隙
      const availableWidth = outerWidth - 32;
      let cellSize = Math.floor((availableWidth - 44) / 54);
      if (cellSize < 13) cellSize = 13;
      if (cellSize > 38) cellSize = 38;

      // 根据动态单元格精确确定图表与内边距，确保完美居中无溢出
      const leftOffset = Math.max(28, Math.round(cellSize * 1.5));
      const topOffset = Math.max(24, Math.round(cellSize * 1.3));
      const rightPadding = Math.max(16, Math.round(cellSize * 0.8));
      const contentWidth = Math.ceil(cellSize * 54 + leftOffset + rightPadding);
      const contentHeight = Math.ceil(cellSize * 7 + topOffset + Math.round(cellSize * 1.2));

      chartDom.style.width = `${contentWidth}px`;
      chartDom.style.height = `${contentHeight}px`;
      chartDom.style.margin = "0 auto";

      let chart = echarts.getInstanceByDom(chartDom);
      if (!chart) {
        chart = markRaw(echarts.init(chartDom));
      }
      heatmapChart = chart;

      const dark = isDark.value;
      const targetYear = selectedHeatmapYear.value || new Date().getFullYear();
      const rawList = rawHeatmap.value || [];
      const currentDataStr = JSON.stringify(rawList);
      const displayKey = `${targetYear}_${heatmapFilter.value}_${dark ? 'dark' : 'light'}_${cellSize}`;
      const currentKey = `${displayKey}##${currentDataStr}`;

      // A4 / A7-1: 真实数据内容与显示参数未变且非强制时跳过 clear() 和重绘
      if (!force && currentKey === lastHeatmapRenderKey) {
        chart.resize();
        return;
      }
      lastHeatmapRenderKey = currentKey;
      if (typeof window !== "undefined") {
        window.__chartClearCounters = window.__chartClearCounters || { heatmap: 0, climbing: 0, daily: 0, tag: 0, pie: 0 };
        window.__chartClearCounters.heatmap++;
        console.log(`[ChartClear] heatmap.clear() called, total: ${window.__chartClearCounters.heatmap}`);
      }
      chart.clear();

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
            fontSize: getChartFontSize(12)
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
          top: topOffset,
          left: leftOffset,
          cellSize: [cellSize, cellSize], /* 动态正方形单元格 [cellSize, cellSize] 严格 1:1 */
          range: [startDateStr, endDateStr],
          itemStyle: {
            color: dark ? "#161618" : "#ebedf0",
            borderColor: dark ? "#000000" : "#ffffff",
            borderWidth: cellSize >= 26 ? 3 : 2,
            borderRadius: Math.max(2, Math.round(cellSize * 0.18))
          },
          splitLine: { show: false },
          yearLabel: { show: false },
          dayLabel: {
            firstDay: 1,
            nameMap: ["日", "一", "二", "三", "四", "五", "六"],
            color: dark ? "#6e6e73" : "#86868b",
            fontSize: Math.max(10, Math.min(16, Math.round(cellSize * 0.46))),
            fontFamily: "JetBrains Mono"
          },
          monthLabel: {
            color: dark ? "#a1a1a6" : "#6e6e73",
            fontSize: Math.max(11, Math.min(17, Math.round(cellSize * 0.50))),
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
    let lastClimbingKey = "";
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
      const displayKey = `climbing_${dark ? 'dark' : 'light'}_${isCurveSmooth.value}_${getChartFontSize(12)}`;
      const currentKey = `${displayKey}##${currentDataStr}`;

      if (!force && chart && currentKey === lastClimbingKey) {
        chart.resize();
        return;
      }
      lastClimbingKey = currentKey;
      if (typeof window !== "undefined") {
        window.__chartClearCounters = window.__chartClearCounters || { heatmap: 0, climbing: 0, daily: 0, tag: 0, pie: 0 };
        window.__chartClearCounters.climbing++;
        console.log(`[ChartClear] climbing.clear() called, total: ${window.__chartClearCounters.climbing}`);
      }
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
            fontSize: getChartFontSize(12)
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
          splitLine: { lineStyle: { color: dark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)" } },
          axisLabel: { color: dark ? "#86868b" : "#86868b", fontSize: getChartFontSize(10), fontFamily: "JetBrains Mono" }
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
    let lastDailyKey = "";
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
      const displayKey = `daily_${dark ? 'dark' : 'light'}_${getChartFontSize(12)}`;
      const currentKey = `${displayKey}##${currentDataStr}`;

      if (!force && chart && currentKey === lastDailyKey) {
        chart.resize();
        return;
      }
      lastDailyKey = currentKey;
      if (typeof window !== "undefined") {
        window.__chartClearCounters = window.__chartClearCounters || { heatmap: 0, climbing: 0, daily: 0, tag: 0, pie: 0 };
        window.__chartClearCounters.daily++;
        console.log(`[ChartClear] daily.clear() called, total: ${window.__chartClearCounters.daily}`);
      }
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
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
            fontSize: getChartFontSize(12)
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
            fontSize: getChartFontSize(11),
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
          axisLabel: { color: dark ? "#86868b" : "#86868b", fontSize: getChartFontSize(10), fontFamily: "JetBrains Mono" }
        },
        yAxis: {
          type: "value",
          splitLine: { lineStyle: { color: dark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)" } },
          axisLabel: { color: dark ? "#86868b" : "#86868b", fontSize: getChartFontSize(10), fontFamily: "JetBrains Mono" }
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
    let lastTagChartKey = "";
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
      const displayKey = `tags_${dark ? 'dark' : 'light'}_${getChartFontSize(12)}`;
      const currentKey = `${displayKey}##${currentDataStr}`;

      if (!force && chart && currentKey === lastTagChartKey) {
        chart.resize();
        return;
      }
      lastTagChartKey = currentKey;
      if (typeof window !== "undefined") {
        window.__chartClearCounters = window.__chartClearCounters || { heatmap: 0, climbing: 0, daily: 0, tag: 0, pie: 0 };
        window.__chartClearCounters.tag++;
        console.log(`[ChartClear] tag.clear() called, total: ${window.__chartClearCounters.tag}`);
      }
      chart.clear();
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
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
            fontSize: getChartFontSize(12)
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
          axisLabel: { color: dark ? "#86868b" : "#86868b", fontSize: getChartFontSize(10), fontFamily: "JetBrains Mono" }
        },
        yAxis: {
          type: "category",
          data: categories,
          axisLine: { lineStyle: { color: dark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.08)" } },
          axisLabel: { color: dark ? "#f5f5f7" : "#1d1d1f", fontSize: getChartFontSize(11), fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif' }
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
    let lastPieKey = "";
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
      const displayKey = `platforms_${dark ? 'dark' : 'light'}_${getChartFontSize(12)}`;
      const currentKey = `${displayKey}##${currentDataStr}`;

      if (!force && chart && currentKey === lastPieKey) {
        chart.resize();
        return;
      }
      lastPieKey = currentKey;
      if (typeof window !== "undefined") {
        window.__chartClearCounters = window.__chartClearCounters || { heatmap: 0, climbing: 0, daily: 0, tag: 0, pie: 0 };
        window.__chartClearCounters.pie++;
        console.log(`[ChartClear] pie.clear() called, total: ${window.__chartClearCounters.pie}`);
      }
      chart.clear();
      const data = [
        { value: pData.codeforces?.ac || 0, name: "Codeforces", itemStyle: { color: dark ? "#2997ff" : "#0071e3" } },
        { value: pData.atcoder?.ac || 0, name: "AtCoder", itemStyle: { color: dark ? "#bf5af2" : "#af52de" } },
        { value: pData.luogu?.ac || 0, name: "洛谷", itemStyle: { color: dark ? "#30d158" : "#34c759" } },
        { value: pData.acwing?.ac || 0, name: "AcWing", itemStyle: { color: dark ? "#ff9f0a" : "#ff9500" } },
        { value: (pData.leetcode?.ac || 0) + (pData.leetcode_cn?.ac || 0), name: "力扣 (LeetCode)", itemStyle: { color: dark ? "#ffd60a" : "#f59e0b" } }
      ].filter(d => d.value > 0);

      const option = {
        tooltip: {
          trigger: "item",
          formatter: "{b}: {c} 题 ({d}%)",
          backgroundColor: dark ? "rgba(20, 20, 22, 0.95)" : "rgba(255, 255, 255, 0.95)",
          borderColor: dark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.08)",
          textStyle: {
            color: dark ? "#f5f5f7" : "#1d1d1f",
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
            fontSize: getChartFontSize(12)
          },
          extraCssText: "backdrop-filter: blur(24px) saturate(180%); border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,0.25);"
        },
        legend: {
          bottom: "6%",
          left: "center",
          textStyle: { color: dark ? "#a1a1a6" : "#6e6e73", fontSize: getChartFontSize(11), fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }
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
              fontSize: getChartFontSize(15),
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
      heatmapFilter.value = p;
      lastHeatmapDataStr = "";
      await loadHeatmap();
      if (currentTab.value === "overview") renderHeatmap(true);
      nextTick(syncSegmentedThumbs);
    };

    const setHeatmapYear = async (yr) => {
      selectedHeatmapYear.value = yr;
      lastHeatmapDataStr = "";
      await loadHeatmap();
      if (currentTab.value === "overview") renderHeatmap(true);
      nextTick(syncSegmentedThumbs);
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
        settingsForm.value.sprint_mode = next;
        settingsBaseline.sprint_mode = next;
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
          body: JSON.stringify(payload),
          timeoutMs: 60000
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
          settingsBaseline.poll_interval_minutes = minsStr;
          settingsBaseline.http_proxy = proxy;
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
          settingsBaseline = {
            ...settingsForm.value,
            poll_interval_minutes: minsStr,
            http_proxy: proxy
          };
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
        showToast(`[${account.alias || account.handle}] 同步完成: 成功获取 ${count} 条提交记录`, "success");
        await Promise.all([loadAccounts(), loadOverview(), loadSubmissions(), loadMistakes(), loadMistakeKeys()]);
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
        showToast("力扣主要通过油猴脚本实时秒级同步提交与源码，支持云端自动免登核实", "info");
        await Promise.all([loadAccounts(), loadOverview(), loadSubmissions(), loadMistakes(), loadMistakeKeys()]);
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
        if (!res.ok || data.success === false) {
          showToast(`${getPlatformName(platform)} 同步未完成: ${data.message || "请求失败"}`, "error");
        } else {
          showToast(`${getPlatformName(platform)} 同步完成: ${data.message || "已获取最新数据"}`, "success");
        }
        await Promise.all([loadAccounts(), loadOverview(), loadSubmissions(), loadMistakes(), loadMistakeKeys()]);
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

    // --- Unified Polling Engine (A1/A2: in-flight guard, failure backoff, tab dispatch) ---
    let pollTimeoutId = null;
    let isPollingInProgress = false;
    let consecutivePollFailures = 0;
    const BASE_POLL_INTERVAL = 15000;
    let currentPollInterval = BASE_POLL_INTERVAL;
    let lastUserRefreshTime = 0;
    let lastContestSyncTime = 0;

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
          currentUser.value = null;
          token.value = "";
          localStorage.removeItem("oiboard_token");
          localStorage.removeItem("oiboard_user");
          fetchCaptcha();
        }
      }
    };

    const executeTabPolling = async () => {
      if (!isLoggedIn.value || document.hidden || isSyncing.value || isSaving.value || isPollingInProgress) {
        scheduleNextPoll();
        return;
      }

      isPollingInProgress = true;
      try {
        const tab = currentTab.value;
        let tasks = [];
        if (tab === "overview") {
          tasks = [loadOverview(), loadHeatmap(), loadTags(), loadContests()];
          lastContestSyncTime = Date.now();
        } else if (tab === "submissions") {
          tasks = [loadSubmissions(), loadMistakeKeys()];
        } else if (tab === "mistakes") {
          tasks = [loadMistakes()];
        } else if (tab === "contests") {
          tasks = [loadContests()];
          lastContestSyncTime = Date.now();
        } else if (tab === "settings") {
          tasks = [pollSettingsReadOnly()];
        }

        // A6-3: 在其他非比赛 Tab 下，每隔 60 秒低频同步一次比赛数据，确保侧边栏待开赛角标与状态不冻结
        const now = Date.now();
        if (tab !== "overview" && tab !== "contests" && (now - lastContestSyncTime >= 60000)) {
          tasks.push(loadContests());
          lastContestSyncTime = now;
        }

        // A6-1: 使用 Promise.allSettled 并发执行，单个请求超时或失败不阻塞其他数据域，且保证锁百分之百释放
        const results = await Promise.allSettled(tasks);
        const hasSuccess = results.some(r => r.status === "fulfilled");
        const allRejected = results.length > 0 && results.every(r => r.status === "rejected");

        // 低频刷新当前用户信息 (60 秒间隔)，401 时自动回到登录态
        await refreshCurrentUser(false);

        if (hasSuccess || results.length === 0) {
          // 至少有成功项，重置退避
          consecutivePollFailures = 0;
          currentPollInterval = BASE_POLL_INTERVAL;
        } else if (allRejected) {
          consecutivePollFailures++;
          currentPollInterval = Math.min(60000, BASE_POLL_INTERVAL * Math.pow(2, consecutivePollFailures));
        }
      } catch (err) {
        consecutivePollFailures++;
        // 连续失败退避：15s -> 30s -> 最多 60s
        currentPollInterval = Math.min(60000, BASE_POLL_INTERVAL * Math.pow(2, consecutivePollFailures));
      } finally {
        isPollingInProgress = false;
        scheduleNextPoll();
      }
    };

    const scheduleNextPoll = (customDelayMs) => {
      if (pollTimeoutId) {
        clearTimeout(pollTimeoutId);
        pollTimeoutId = null;
      }
      const delay = typeof customDelayMs === "number" ? customDelayMs : currentPollInterval;
      pollTimeoutId = setTimeout(() => {
        executeTabPolling();
      }, delay);
    };

    const triggerImmediatePoll = () => {
      if (!isPollingInProgress) {
        scheduleNextPoll(0);
      }
    };

    // --- Timers and Global Event Handlers ---
    let themeTimer = null;
    let countdownTimer = null;
    let resizeDebounceTimer = null;
    let lastForegroundWakeupTime = 0;

    const onWindowResize = () => {
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
      if (e.key === "Escape" && viewNoteModalOpen.value) {
        viewNoteModalOpen.value = false;
      }
    };

    const onForegroundWakeup = () => {
      if (document.hidden) return;
      const now = Date.now();
      if (now - lastForegroundWakeupTime < 2000) {
        return;
      }
      lastForegroundWakeupTime = now;
      refreshCurrentUser(true);
      triggerImmediatePoll();
    };

    // --- Lifecycle ---
    onMounted(async () => {
      // 初始化应用主题模式与高分屏缩放比例
      applyTheme();
      applyUiScale();

      // 30 秒级自动昼夜检测定时器 (仅在 auto 模式下无感平滑切换)
      themeTimer = setInterval(() => {
        if (themePref.value === "auto") {
          const shouldBeDark = !isDaylightTime();
          if (isDark.value !== shouldBeDark) {
            applyTheme();
          }
        }
      }, 30000);

      // A6-3: 分级时钟驱动 (概览/比赛页 1s 精度更新倒计时，其他非活跃页面 30s 精度保持侧边栏角标不冻结)
      let idleTabSeconds = 0;
      countdownTimer = setInterval(() => {
        if (document.hidden) return;
        if (currentTab.value === 'contests' || currentTab.value === 'overview') {
          updateContestMetas();
          idleTabSeconds = 0;
        } else {
          idleTabSeconds++;
          if (idleTabSeconds >= 30) {
            idleTabSeconds = 0;
            updateContestMetas();
          }
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

      window.addEventListener("resize", onWindowResize);
      window.addEventListener("keydown", onKeydown);
      document.addEventListener("visibilitychange", onForegroundWakeup);
      window.addEventListener("focus", onForegroundWakeup);

      nextTick(() => {
        syncSegmentedThumbs();
        updateContestMetas();
      });

      // 启动统一静默轮询调度器 (15 秒基础周期，具备防重叠与失败退避)
      scheduleNextPoll(BASE_POLL_INTERVAL);
    });

    onUnmounted(() => {
      if (themeTimer) clearInterval(themeTimer);
      if (countdownTimer) clearInterval(countdownTimer);
      if (pollTimeoutId) clearTimeout(pollTimeoutId);
      if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);

      window.removeEventListener("resize", onWindowResize);
      window.removeEventListener("keydown", onKeydown);
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
      mistakePage.value = 1;
      loadMistakes();
      nextTick(syncSegmentedThumbs);
    });

    // 标签页切换自动静默拉取最新数据，概览页重新加载热力图与图表，彻底告别手动硬刷新
    watch(currentTab, async (tab) => {
      if (tab === "overview") {
        await Promise.all([loadOverview(), loadHeatmap(), loadTags(), loadContests()]);
        nextTick(() => {
          renderHeatmap(true);
          renderActiveChart(true);
          syncSegmentedThumbs();
        });
      } else {
        if (tab === "submissions") {
          await Promise.all([loadSubmissions(), loadMistakeKeys()]);
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
      // 切换标签后，重置并顺延后台轮询计时
      scheduleNextPoll(BASE_POLL_INTERVAL);
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
      // UI Scale Engine exports
      uiScalePref,
      setUiScalePref,
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
      insertCodeSnippet,
      // Local Agent Token exports
      isTokenCopied,
      copySyncToken
    };
  }
}).mount("#app");
