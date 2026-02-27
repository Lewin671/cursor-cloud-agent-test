/* global WebSocket */
(function () {
  "use strict";

  // --- State ---
  let token = localStorage.getItem("pomodoro_token");
  let user = null;
  let timerState = null;
  let settings = null;
  let localInterval = null;
  let ws = null;
  let wsReconnectTimer = null;

  // --- DOM refs ---
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const authView = $("#auth-view");
  const timerView = $("#timer-view");
  const loginForm = $("#login-form");
  const registerForm = $("#register-form");
  const loginError = $("#login-error");
  const registerError = $("#register-error");
  const timerTime = $("#timer-time");
  const timerLabel = $("#timer-label");
  const timerRing = $("#timer-ring-progress");
  const startBtn = $("#start-btn");
  const pauseBtn = $("#pause-btn");
  const resumeBtn = $("#resume-btn");
  const resetBtn = $("#reset-btn");
  const sessionCount = $("#session-count");
  const sessionTarget = $("#session-target");
  const deviceCount = $("#device-count");
  const usernameDisplay = $("#username-display");
  const settingsModal = $("#settings-modal");
  const settingsForm = $("#settings-form");
  const statSessions = $("#stat-sessions");
  const statMinutes = $("#stat-minutes");
  const historyList = $("#history-list");

  const CIRCUMFERENCE = 2 * Math.PI * 110; // r=110

  // --- API helpers ---
  async function api(path, options = {}) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = "Bearer " + token;

    const res = await fetch(path, {
      ...options,
      headers: { ...headers, ...options.headers },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  // --- Auth ---
  $$(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      loginForm.classList.toggle("hidden", tab !== "login");
      registerForm.classList.toggle("hidden", tab !== "register");
      loginError.textContent = "";
      registerError.textContent = "";
    });
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.textContent = "";
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: {
          username: $("#login-username").value.trim(),
          password: $("#login-password").value,
        },
      });
      token = data.token;
      user = data.user;
      localStorage.setItem("pomodoro_token", token);
      showTimerView();
    } catch (err) {
      loginError.textContent = err.message;
    }
  });

  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    registerError.textContent = "";
    try {
      const data = await api("/api/auth/register", {
        method: "POST",
        body: {
          username: $("#register-username").value.trim(),
          password: $("#register-password").value,
        },
      });
      token = data.token;
      user = data.user;
      localStorage.setItem("pomodoro_token", token);
      showTimerView();
    } catch (err) {
      registerError.textContent = err.message;
    }
  });

  $("#logout-btn").addEventListener("click", () => {
    token = null;
    user = null;
    localStorage.removeItem("pomodoro_token");
    stopLocalTimer();
    disconnectWs();
    authView.classList.remove("hidden");
    timerView.classList.add("hidden");
  });

  // --- Timer View ---
  async function showTimerView() {
    authView.classList.add("hidden");
    timerView.classList.remove("hidden");

    try {
      const meData = await api("/api/auth/me");
      user = meData.user;
      usernameDisplay.textContent = user.username;
    } catch {
      token = null;
      localStorage.removeItem("pomodoro_token");
      authView.classList.remove("hidden");
      timerView.classList.add("hidden");
      return;
    }

    await loadTimerState();
    await loadSessions();
    connectWs();
  }

  async function loadTimerState() {
    try {
      const data = await api("/api/timer");
      timerState = data.timer;
      settings = data.settings;
      updateDeviceCount(data.deviceCount);
      applyTimerState();
    } catch (err) {
      showToast("加载失败: " + err.message);
    }
  }

  function applyTimerState() {
    if (!timerState || !settings) return;

    // Update theme
    document.body.className = "theme-" + timerState.timer_type;

    // Update tabs
    $$(".timer-tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.type === timerState.timer_type);
    });

    // Update label
    const labels = { work: "专注时间", short_break: "短休息", long_break: "长休息" };
    timerLabel.textContent = labels[timerState.timer_type] || "专注时间";

    // Update session counter
    sessionCount.textContent = timerState.completed_count || 0;
    sessionTarget.textContent = settings.long_break_interval || 4;

    // Update buttons
    const status = timerState.status;
    startBtn.classList.toggle("hidden", status !== "idle");
    pauseBtn.classList.toggle("hidden", status !== "running");
    resumeBtn.classList.toggle("hidden", status !== "paused");

    // Compute remaining
    stopLocalTimer();
    if (status === "running") {
      startLocalTimer();
    } else {
      updateTimerDisplay(timerState.remaining);
    }
  }

  // --- Local timer tick ---
  function startLocalTimer() {
    stopLocalTimer();
    renderTick();
    localInterval = setInterval(renderTick, 200);
  }

  function renderTick() {
    if (!timerState || timerState.status !== "running") return;

    const startedAt = new Date(timerState.started_at).getTime();
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    const remaining = Math.max(0, timerState.remaining - elapsed);

    updateTimerDisplay(remaining);

    if (remaining <= 0) {
      stopLocalTimer();
      completeTimer();
    }
  }

  function stopLocalTimer() {
    if (localInterval) {
      clearInterval(localInterval);
      localInterval = null;
    }
  }

  function updateTimerDisplay(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    timerTime.textContent = String(mins).padStart(2, "0") + ":" + String(secs).padStart(2, "0");

    // Update ring progress
    const total = timerState ? timerState.duration : 1;
    const fraction = seconds / total;
    const offset = CIRCUMFERENCE * (1 - fraction);
    timerRing.style.strokeDasharray = CIRCUMFERENCE;
    timerRing.style.strokeDashoffset = offset;
  }

  // --- Timer controls ---
  startBtn.addEventListener("click", async () => {
    try {
      const data = await api("/api/timer/start", {
        method: "POST",
        body: { timerType: timerState.timer_type },
      });
      timerState = data.timer;
      applyTimerState();
    } catch (err) {
      showToast("启动失败: " + err.message);
    }
  });

  pauseBtn.addEventListener("click", async () => {
    try {
      const data = await api("/api/timer/pause", { method: "POST" });
      timerState = data.timer;
      applyTimerState();
    } catch (err) {
      showToast("暂停失败: " + err.message);
    }
  });

  resumeBtn.addEventListener("click", async () => {
    try {
      const data = await api("/api/timer/start", { method: "POST" });
      timerState = data.timer;
      applyTimerState();
    } catch (err) {
      showToast("继续失败: " + err.message);
    }
  });

  resetBtn.addEventListener("click", async () => {
    try {
      const data = await api("/api/timer/reset", {
        method: "POST",
        body: { timerType: timerState.timer_type },
      });
      timerState = data.timer;
      applyTimerState();
    } catch (err) {
      showToast("重置失败: " + err.message);
    }
  });

  // Timer type tabs
  $$(".timer-tab").forEach((tab) => {
    tab.addEventListener("click", async () => {
      if (timerState && timerState.status === "running") return;

      const newType = tab.dataset.type;
      try {
        const data = await api("/api/timer/reset", {
          method: "POST",
          body: { timerType: newType },
        });
        timerState = data.timer;
        applyTimerState();
      } catch (err) {
        showToast("切换失败: " + err.message);
      }
    });
  });

  async function completeTimer() {
    try {
      const data = await api("/api/timer/complete", { method: "POST" });
      timerState = data.timer;
      applyTimerState();
      await loadSessions();
      showToast("🍅 番茄完成！");
    } catch (err) {
      showToast("完成记录失败: " + err.message);
    }
  }

  // --- Sessions ---
  async function loadSessions() {
    try {
      const data = await api("/api/sessions");
      renderHistory(data.sessions);
      statSessions.textContent = data.stats.work_sessions;
      statMinutes.textContent = Math.round(data.stats.total_work_seconds / 60);
    } catch {
      // Silently fail
    }
  }

  function renderHistory(sessions) {
    if (!sessions || sessions.length === 0) {
      historyList.innerHTML = '<li class="history-empty">暂无记录</li>';
      return;
    }

    const icons = { work: "🍅", short_break: "☕", long_break: "🌴" };
    const typeNames = { work: "专注", short_break: "短休息", long_break: "长休息" };

    historyList.innerHTML = sessions
      .map((s) => {
        const time = new Date(s.completed_at + "Z").toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        });
        const date = new Date(s.completed_at + "Z").toLocaleDateString("zh-CN", {
          month: "short",
          day: "numeric",
        });
        const durMin = Math.round(s.duration / 60);
        return '<li class="history-item">' +
          '<div class="history-icon ' + s.timer_type + '">' + (icons[s.timer_type] || "🍅") + "</div>" +
          '<div class="history-info">' +
          '<div class="history-type">' + (typeNames[s.timer_type] || s.timer_type) + "</div>" +
          '<div class="history-time">' + date + " " + time + "</div>" +
          "</div>" +
          '<div class="history-duration">' + durMin + "分钟</div>" +
          "</li>";
      })
      .join("");
  }

  $("#clear-history-btn").addEventListener("click", async () => {
    if (!confirm("确定要清空所有历史记录吗？")) return;
    try {
      await api("/api/sessions", { method: "DELETE" });
      await loadSessions();
      showToast("历史记录已清空");
    } catch (err) {
      showToast("清空失败: " + err.message);
    }
  });

  // --- Settings ---
  $("#settings-btn").addEventListener("click", () => {
    if (settings) {
      $("#setting-work").value = Math.round(settings.work_duration / 60);
      $("#setting-short-break").value = Math.round(settings.short_break_duration / 60);
      $("#setting-long-break").value = Math.round(settings.long_break_duration / 60);
      $("#setting-interval").value = settings.long_break_interval;
    }
    settingsModal.classList.remove("hidden");
  });

  $("#settings-cancel").addEventListener("click", () => {
    settingsModal.classList.add("hidden");
  });

  $(".modal-backdrop").addEventListener("click", () => {
    settingsModal.classList.add("hidden");
  });

  settingsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const data = await api("/api/settings", {
        method: "PUT",
        body: {
          work_duration: parseInt($("#setting-work").value) * 60,
          short_break_duration: parseInt($("#setting-short-break").value) * 60,
          long_break_duration: parseInt($("#setting-long-break").value) * 60,
          long_break_interval: parseInt($("#setting-interval").value),
        },
      });
      settings = data.settings;
      settingsModal.classList.add("hidden");
      showToast("设置已保存");

      if (timerState && timerState.status === "idle") {
        await loadTimerState();
      }
    } catch (err) {
      showToast("保存失败: " + err.message);
    }
  });

  // --- WebSocket Sync ---
  function connectWs() {
    disconnectWs();
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(protocol + "//" + location.host + "/ws");

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "auth", token }));
    });

    ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleWsMessage(msg);
      } catch {
        // Ignore malformed messages
      }
    });

    ws.addEventListener("close", () => {
      scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      // Will trigger close
    });
  }

  function disconnectWs() {
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
  }

  function scheduleReconnect() {
    if (!token) return;
    wsReconnectTimer = setTimeout(() => {
      if (token) connectWs();
    }, 3000);
  }

  function handleWsMessage(msg) {
    switch (msg.type) {
      case "sync:connected":
        updateDeviceCount(msg.deviceCount);
        break;
      case "sync:device_joined":
      case "sync:device_left":
        updateDeviceCount(msg.deviceCount);
        showToast(msg.type === "sync:device_joined" ? "📱 新设备已连接" : "📱 设备已断开");
        break;
      case "timer:state":
        timerState = msg.data;
        applyTimerState();
        break;
      case "timer:completed":
        timerState = msg.data.timer;
        applyTimerState();
        loadSessions();
        showToast("🍅 番茄完成！（来自其他设备）");
        break;
      case "settings:updated":
        settings = msg.data;
        showToast("⚙️ 设置已更新（来自其他设备）");
        if (timerState && timerState.status === "idle") {
          loadTimerState();
        }
        break;
    }
  }

  function updateDeviceCount(count) {
    deviceCount.textContent = count || 1;
  }

  // --- Toast ---
  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 3000);
  }

  // --- Init ---
  if (token) {
    showTimerView();
  }
})();
