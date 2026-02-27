const phaseTextMap = {
  focus: "专注阶段",
  shortBreak: "短休息阶段",
  longBreak: "长休息阶段",
};

const statusTextMap = {
  idle: "等待开始",
  running: "进行中",
  paused: "已暂停",
};

const AUTH_TOKEN_KEY = "pomodoro_auth_token";
const AUTH_USER_KEY = "pomodoro_auth_user";

const ui = {
  userIdInput: document.querySelector("#userIdInput"),
  passwordInput: document.querySelector("#passwordInput"),
  registerBtn: document.querySelector("#registerBtn"),
  loginBtn: document.querySelector("#loginBtn"),
  logoutBtn: document.querySelector("#logoutBtn"),
  refreshBtn: document.querySelector("#refreshBtn"),
  authStatus: document.querySelector("#authStatus"),
  syncStatus: document.querySelector("#syncStatus"),
  phaseLabel: document.querySelector("#phaseLabel"),
  countdown: document.querySelector("#countdown"),
  timerStatus: document.querySelector("#timerStatus"),
  startPauseBtn: document.querySelector("#startPauseBtn"),
  resetBtn: document.querySelector("#resetBtn"),
  skipBtn: document.querySelector("#skipBtn"),
  focusMinutesInput: document.querySelector("#focusMinutesInput"),
  shortBreakMinutesInput: document.querySelector("#shortBreakMinutesInput"),
  longBreakMinutesInput: document.querySelector("#longBreakMinutesInput"),
  longBreakEveryInput: document.querySelector("#longBreakEveryInput"),
  saveSettingsBtn: document.querySelector("#saveSettingsBtn"),
  taskInput: document.querySelector("#taskInput"),
  addTaskBtn: document.querySelector("#addTaskBtn"),
  taskList: document.querySelector("#taskList"),
  completedCount: document.querySelector("#completedCount"),
  versionText: document.querySelector("#versionText"),
  updatedAtText: document.querySelector("#updatedAtText"),
  feedback: document.querySelector("#feedback"),
};

let activeUserId = localStorage.getItem(AUTH_USER_KEY) || "";
let authToken = localStorage.getItem(AUTH_TOKEN_KEY) || "";
let currentState = null;
let eventSource = null;
let clockOffsetMs = 0;

function setFeedback(message, isError = false) {
  ui.feedback.textContent = message;
  ui.feedback.style.color = isError ? "#fda4af" : "#34d399";
}

function setAuthStatus(message) {
  ui.authStatus.textContent = message;
}

function setSyncStatus(message) {
  ui.syncStatus.textContent = message;
}

function toDisplayTime(timestamp) {
  if (!Number.isInteger(timestamp)) {
    return "-";
  }

  return new Date(timestamp).toLocaleString();
}

function formatRemainingTime(remainingMs) {
  const safeSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getRemainingMsForRender() {
  if (!currentState || !currentState.timer) {
    return 0;
  }

  if (currentState.timer.status === "running" && Number.isInteger(currentState.timer.endAt)) {
    const serverEstimatedNow = Date.now() + clockOffsetMs;
    return Math.max(0, currentState.timer.endAt - serverEstimatedNow);
  }

  return currentState.timer.remainingMs;
}

function renderTimerOnly() {
  ui.countdown.textContent = formatRemainingTime(getRemainingMsForRender());
}

function renderTaskList(tasks) {
  ui.taskList.innerHTML = "";

  if (!tasks.length) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "task-item";
    emptyItem.textContent = "暂无任务";
    ui.taskList.appendChild(emptyItem);
    return;
  }

  for (const task of tasks) {
    const item = document.createElement("li");
    item.className = "task-item";

    const main = document.createElement("label");
    main.className = "task-main";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(task.completed);
    checkbox.dataset.taskId = task.id;

    const title = document.createElement("span");
    title.className = "task-title";
    if (task.completed) {
      title.classList.add("completed");
    }
    title.textContent = task.title;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.dataset.deleteTaskId = task.id;
    removeButton.textContent = "删除";

    main.appendChild(checkbox);
    main.appendChild(title);
    item.appendChild(main);
    item.appendChild(removeButton);
    ui.taskList.appendChild(item);
  }
}

function isLoggedIn() {
  return Boolean(authToken && activeUserId);
}

function updateDisabledState() {
  const loggedIn = isLoggedIn();
  const hasState = loggedIn && Boolean(currentState);

  ui.userIdInput.disabled = loggedIn;
  ui.passwordInput.disabled = loggedIn;
  ui.registerBtn.disabled = loggedIn;
  ui.loginBtn.disabled = loggedIn;
  ui.logoutBtn.disabled = !loggedIn;

  ui.refreshBtn.disabled = !loggedIn;
  ui.startPauseBtn.disabled = !hasState;
  ui.resetBtn.disabled = !hasState;
  ui.skipBtn.disabled = !hasState;
  ui.saveSettingsBtn.disabled = !hasState;
  ui.addTaskBtn.disabled = !hasState;
  ui.taskInput.disabled = !hasState;
}

function renderState() {
  if (!currentState) {
    ui.phaseLabel.textContent = "专注阶段";
    ui.timerStatus.textContent = "等待开始";
    ui.countdown.textContent = "25:00";
    ui.completedCount.textContent = "0";
    ui.versionText.textContent = "-";
    ui.updatedAtText.textContent = "-";
    ui.startPauseBtn.textContent = "开始";
    renderTaskList([]);
    updateDisabledState();
    return;
  }

  const { timer, settings, stats, tasks } = currentState;
  ui.phaseLabel.textContent = phaseTextMap[timer.phase] || "未知阶段";
  ui.timerStatus.textContent = statusTextMap[timer.status] || "未知状态";
  ui.startPauseBtn.textContent = timer.status === "running" ? "暂停" : timer.status === "paused" ? "继续" : "开始";

  ui.focusMinutesInput.value = String(settings.focusMinutes);
  ui.shortBreakMinutesInput.value = String(settings.shortBreakMinutes);
  ui.longBreakMinutesInput.value = String(settings.longBreakMinutes);
  ui.longBreakEveryInput.value = String(settings.longBreakEvery);

  ui.completedCount.textContent = String(stats.completedFocusSessions);
  ui.versionText.textContent = String(currentState.version);
  ui.updatedAtText.textContent = toDisplayTime(currentState.updatedAt);
  renderTaskList(tasks);
  renderTimerOnly();
  updateDisabledState();
}

function normalizeUserId(rawUserId) {
  return String(rawUserId || "").trim();
}

function validateUserId(userId) {
  if (!userId) {
    throw new Error("请输入用户 ID");
  }
  if (userId.length > 40) {
    throw new Error("用户 ID 不能超过 40 个字符");
  }
  if (/\s/.test(userId)) {
    throw new Error("用户 ID 不能包含空格");
  }
}

function validatePassword(password) {
  if (!password) {
    throw new Error("请输入密码");
  }
  if (password.length < 8 || password.length > 128) {
    throw new Error("密码长度需为 8 到 128 位");
  }
}

function closeEventStream() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

function clearLocalSession() {
  authToken = "";
  activeUserId = "";
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
}

function applyStatePayload(payload) {
  if (!payload || typeof payload !== "object" || !payload.state) {
    return;
  }

  currentState = payload.state;
  if (typeof payload.serverNow === "number") {
    clockOffsetMs = payload.serverNow - Date.now();
  }
  renderState();
}

function buildRequestHeaders(customHeaders, includeAuth) {
  const headers = { ...customHeaders };
  if (includeAuth && authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  return headers;
}

function handleUnauthorized(message) {
  closeEventStream();
  clearLocalSession();
  currentState = null;
  ui.passwordInput.value = "";
  setAuthStatus("未登录");
  setSyncStatus("会话失效，请重新登录");
  renderState();
  setFeedback(message || "会话失效，请重新登录", true);
}

async function requestJson(url, options = {}) {
  const method = options.method || "GET";
  const includeAuth = options.includeAuth !== false;
  const headers = buildRequestHeaders(options.headers || {}, includeAuth);
  let body;

  if (Object.hasOwn(options, "body")) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const response = await fetch(url, { method, headers, body });
  const rawText = await response.text();
  let payload = {};

  if (rawText.trim()) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      throw new Error("服务端返回了无效数据");
    }
  }

  if (response.status === 401 && includeAuth) {
    handleUnauthorized(payload.error || "会话失效");
    throw new Error(payload.error || "会话失效");
  }

  if (!response.ok) {
    throw new Error(payload.error || "请求失败");
  }

  return payload;
}

async function getStateFromServer() {
  const payload = await requestJson("/api/state");
  applyStatePayload(payload);
}

function connectEventStream() {
  closeEventStream();
  eventSource = new EventSource(`/api/stream?token=${encodeURIComponent(authToken)}`);

  eventSource.addEventListener("state", (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.userId !== activeUserId) {
        return;
      }
      applyStatePayload(payload);
      setSyncStatus(`同步中：${activeUserId}`);
    } catch {
      setFeedback("收到异常同步数据", true);
    }
  });

  eventSource.addEventListener("heartbeat", (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (typeof payload.serverNow === "number") {
        clockOffsetMs = payload.serverNow - Date.now();
      }
    } catch {
      // Ignore heartbeat parse errors.
    }
  });

  eventSource.onerror = () => {
    if (isLoggedIn()) {
      setSyncStatus("连接波动，正在自动重连...");
    }
  };
}

async function sendAction(type, payload = {}) {
  if (!isLoggedIn()) {
    throw new Error("请先登录");
  }

  const result = await requestJson("/api/action", {
    method: "POST",
    body: { type, payload },
  });

  applyStatePayload(result);
}

function withErrorBoundary(fn) {
  return async () => {
    try {
      await fn();
    } catch (error) {
      setFeedback(error.message || "请求失败", true);
    }
  };
}

async function openSession(payload) {
  authToken = payload.token;
  activeUserId = payload.userId;
  localStorage.setItem(AUTH_TOKEN_KEY, authToken);
  localStorage.setItem(AUTH_USER_KEY, activeUserId);
  ui.passwordInput.value = "";
  setAuthStatus(`已登录：${activeUserId}`);
  setSyncStatus("同步连接中...");
  await getStateFromServer();
  connectEventStream();
  setSyncStatus(`同步中：${activeUserId}`);
  renderState();
}

async function restoreSession() {
  if (!authToken) {
    setAuthStatus("未登录");
    setSyncStatus("未建立同步连接");
    return;
  }

  const payload = await requestJson("/api/auth/me");
  activeUserId = payload.userId;
  localStorage.setItem(AUTH_USER_KEY, activeUserId);
  setAuthStatus(`已登录：${activeUserId}`);
  setSyncStatus("同步连接中...");
  await getStateFromServer();
  connectEventStream();
  setSyncStatus(`同步中：${activeUserId}`);
}

ui.registerBtn.addEventListener(
  "click",
  withErrorBoundary(async () => {
    const userId = normalizeUserId(ui.userIdInput.value);
    const password = String(ui.passwordInput.value || "");
    validateUserId(userId);
    validatePassword(password);

    const payload = await requestJson("/api/auth/register", {
      method: "POST",
      includeAuth: false,
      body: { userId, password },
    });
    await openSession(payload);
    setFeedback("注册成功，已自动登录", false);
  }),
);

ui.loginBtn.addEventListener(
  "click",
  withErrorBoundary(async () => {
    const userId = normalizeUserId(ui.userIdInput.value);
    const password = String(ui.passwordInput.value || "");
    validateUserId(userId);
    validatePassword(password);

    const payload = await requestJson("/api/auth/login", {
      method: "POST",
      includeAuth: false,
      body: { userId, password },
    });
    await openSession(payload);
    setFeedback("登录成功", false);
  }),
);

ui.logoutBtn.addEventListener(
  "click",
  withErrorBoundary(async () => {
    if (authToken) {
      await requestJson("/api/auth/logout", { method: "POST" });
    }
    closeEventStream();
    clearLocalSession();
    currentState = null;
    setAuthStatus("未登录");
    setSyncStatus("未建立同步连接");
    renderState();
    setFeedback("已退出登录", false);
  }),
);

ui.refreshBtn.addEventListener(
  "click",
  withErrorBoundary(async () => {
    if (!isLoggedIn()) {
      throw new Error("请先登录");
    }
    await getStateFromServer();
    setFeedback("已刷新数据", false);
  }),
);

ui.startPauseBtn.addEventListener(
  "click",
  withErrorBoundary(async () => {
    if (!currentState) {
      return;
    }
    const actionType = currentState.timer.status === "running" ? "PAUSE" : "START";
    await sendAction(actionType);
  }),
);

ui.resetBtn.addEventListener(
  "click",
  withErrorBoundary(async () => {
    await sendAction("RESET");
  }),
);

ui.skipBtn.addEventListener(
  "click",
  withErrorBoundary(async () => {
    await sendAction("SKIP");
  }),
);

ui.saveSettingsBtn.addEventListener(
  "click",
  withErrorBoundary(async () => {
    const nextSettings = {
      focusMinutes: Number(ui.focusMinutesInput.value),
      shortBreakMinutes: Number(ui.shortBreakMinutesInput.value),
      longBreakMinutes: Number(ui.longBreakMinutesInput.value),
      longBreakEvery: Number(ui.longBreakEveryInput.value),
    };
    await sendAction("UPDATE_SETTINGS", nextSettings);
    setFeedback("设置已同步", false);
  }),
);

ui.addTaskBtn.addEventListener(
  "click",
  withErrorBoundary(async () => {
    const title = ui.taskInput.value.trim();
    if (!title) {
      throw new Error("请输入任务标题");
    }
    await sendAction("ADD_TASK", { title });
    ui.taskInput.value = "";
    setFeedback("任务已添加并同步", false);
  }),
);

ui.taskList.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") {
    return;
  }

  const taskId = target.dataset.taskId;
  if (!taskId) {
    return;
  }

  withErrorBoundary(async () => {
    await sendAction("TOGGLE_TASK", {
      taskId,
      completed: target.checked,
    });
  })();
});

ui.taskList.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  const taskId = target.dataset.deleteTaskId;
  if (!taskId) {
    return;
  }

  withErrorBoundary(async () => {
    await sendAction("DELETE_TASK", { taskId });
  })();
});

setInterval(() => {
  renderTimerOnly();
}, 250);

(async () => {
  renderState();
  updateDisabledState();
  try {
    await restoreSession();
  } catch {
    // Session restore errors are already handled centrally.
  }
  renderState();
})();
