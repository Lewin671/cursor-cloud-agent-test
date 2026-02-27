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

const ui = {
  userIdInput: document.querySelector("#userIdInput"),
  connectBtn: document.querySelector("#connectBtn"),
  refreshBtn: document.querySelector("#refreshBtn"),
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

let activeUserId = "";
let currentState = null;
let eventSource = null;
let clockOffsetMs = 0;

function setFeedback(message, isError = false) {
  ui.feedback.textContent = message;
  ui.feedback.style.color = isError ? "#fda4af" : "#34d399";
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

function updateDisabledState() {
  const isConnected = Boolean(activeUserId && currentState);
  ui.refreshBtn.disabled = !activeUserId;
  ui.startPauseBtn.disabled = !isConnected;
  ui.resetBtn.disabled = !isConnected;
  ui.skipBtn.disabled = !isConnected;
  ui.saveSettingsBtn.disabled = !isConnected;
  ui.addTaskBtn.disabled = !isConnected;
  ui.taskInput.disabled = !isConnected;
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
    throw new Error("请先输入用户 ID");
  }
  if (userId.length > 40) {
    throw new Error("用户 ID 不能超过 40 个字符");
  }
  if (/\s/.test(userId)) {
    throw new Error("用户 ID 不能包含空格");
  }
}

function closeEventStream() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
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

async function getStateFromServer() {
  const response = await fetch(`/api/state?userId=${encodeURIComponent(activeUserId)}`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "获取状态失败");
  }

  applyStatePayload(payload);
}

function connectEventStream() {
  closeEventStream();

  eventSource = new EventSource(`/api/stream?userId=${encodeURIComponent(activeUserId)}`);

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
    setSyncStatus("连接波动，正在自动重连...");
  };
}

async function sendAction(type, payload = {}) {
  if (!activeUserId) {
    setFeedback("请先连接用户 ID", true);
    return;
  }

  const response = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: activeUserId,
      type,
      payload,
    }),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || "操作失败");
  }

  applyStatePayload(result);
}

function withErrorBoundary(fn) {
  return async () => {
    try {
      await fn();
      setFeedback("", false);
    } catch (error) {
      setFeedback(error.message || "请求失败", true);
    }
  };
}

ui.connectBtn.addEventListener(
  "click",
  withErrorBoundary(async () => {
    const userId = normalizeUserId(ui.userIdInput.value);
    validateUserId(userId);

    activeUserId = userId;
    setSyncStatus(`连接中：${activeUserId}`);
    await getStateFromServer();
    connectEventStream();
    setSyncStatus(`已连接：${activeUserId}`);
  }),
);

ui.refreshBtn.addEventListener(
  "click",
  withErrorBoundary(async () => {
    if (!activeUserId) {
      setFeedback("请先连接用户 ID", true);
      return;
    }
    await getStateFromServer();
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
      setFeedback("请输入任务标题", true);
      return;
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

renderState();
