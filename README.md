# Pomodoro Sync App

一个支持多设备数据同步的番茄时间应用，采用前后端分离架构：

- 前端：React + TypeScript（Vite）
- 后端：Go + Gin
- 数据库：SQLite（持久化本地文件）
- 鉴权：JWT（支持同账号多设备同时登录）

## 功能概览

- 用户注册 / 登录
- JWT 鉴权与用户数据隔离
- 番茄钟开始 / 暂停 / 重置
- 支持专注 / 短休息 / 长休息模式
- 自定义时长（默认 25/5/15 分钟）
- 专注历史记录持久化
- 多设备状态同步（含进行中计时恢复）
- 乐观锁版本控制，避免并发覆盖

## 项目结构

```text
.
├── backend
│   ├── cmd
│   │   ├── migrate
│   │   │   └── main.go
│   │   └── server
│   │       └── main.go
│   ├── internal
│   │   ├── config
│   │   │   └── config.go
│   │   ├── db
│   │   │   └── sqlite.go
│   │   ├── errors
│   │   │   └── api_error.go
│   │   ├── handler
│   │   │   ├── auth_handler.go
│   │   │   ├── pomodoro_handler.go
│   │   │   └── response.go
│   │   ├── middleware
│   │   │   ├── auth_middleware.go
│   │   │   └── cors_middleware.go
│   │   ├── model
│   │   │   ├── pomodoro.go
│   │   │   └── user.go
│   │   ├── repository
│   │   │   ├── errors.go
│   │   │   ├── pomodoro_repository.go
│   │   │   ├── time.go
│   │   │   └── user_repository.go
│   │   ├── router
│   │   │   └── router.go
│   │   └── service
│   │       ├── auth_service.go
│   │       └── pomodoro_service.go
│   ├── migrations
│   │   └── 001_init.sql
│   ├── .env.example
│   └── go.mod
├── frontend
│   ├── src
│   │   ├── api
│   │   │   ├── auth.ts
│   │   │   ├── client.ts
│   │   │   └── pomodoro.ts
│   │   ├── components
│   │   │   ├── AuthForm.tsx
│   │   │   ├── HistoryList.tsx
│   │   │   ├── ModeSelector.tsx
│   │   │   ├── SettingsPanel.tsx
│   │   │   └── TimerCard.tsx
│   │   ├── hooks
│   │   │   ├── useAuth.tsx
│   │   │   └── usePomodoro.ts
│   │   ├── App.tsx
│   │   ├── config.ts
│   │   ├── index.css
│   │   ├── main.tsx
│   │   └── types.ts
│   ├── .env.example
│   └── package.json
├── scripts
│   ├── dev.sh
│   └── init_db.sh
├── package.json
└── README.md
```

## 环境变量

### 后端（`backend/.env`）

参考 `backend/.env.example`：

```env
PORT=8080
DB_PATH=./data/pomodoro.db
JWT_SECRET=replace-with-a-secure-secret
TOKEN_TTL_HOURS=72
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
MIGRATIONS_DIR=./migrations
```

### 前端（`frontend/.env`）

参考 `frontend/.env.example`：

```env
VITE_API_BASE_URL=http://localhost:8080/api
```

## 启动方式

### 1) 安装前端依赖

```bash
cd frontend
npm install
```

### 2) 初始化数据库（执行迁移）

```bash
cd ..
npm run migrate
# 或 ./scripts/init_db.sh
```

### 3) 启动前后端

方式 A：一键启动

```bash
npm run dev
```

方式 B：分开启动

```bash
npm run dev:backend
npm run dev:frontend
```

- 前端默认地址：`http://localhost:5173`
- 后端默认地址：`http://localhost:8080`

## REST API 定义

统一返回 JSON。错误结构：

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "details": {}
  }
}
```

### Auth

#### `POST /api/auth/register`

请求：

```json
{
  "email": "user@example.com",
  "password": "123456"
}
```

响应：

```json
{
  "token": "jwt-token",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "createdAt": "2026-01-01T00:00:00Z",
    "updatedAt": "2026-01-01T00:00:00Z"
  }
}
```

#### `POST /api/auth/login`

同 register 请求，返回相同结构。

### Pomodoro（需 `Authorization: Bearer <token>`）

#### `GET /api/pomodoro/state`

响应：

```json
{
  "state": {
    "userId": "uuid",
    "mode": "focus",
    "status": "running",
    "remainingSeconds": 1470,
    "focusDurationSeconds": 1500,
    "shortBreakDurationSeconds": 300,
    "longBreakDurationSeconds": 900,
    "startedAt": "2026-01-01T00:00:00Z",
    "sessionId": "uuid",
    "version": 5,
    "updatedAt": "2026-01-01T00:00:00Z",
    "serverTime": "2026-01-01T00:00:30Z"
  }
}
```

#### `POST /api/pomodoro/start`

请求：

```json
{ "baseVersion": 5 }
```

#### `POST /api/pomodoro/pause`

请求：

```json
{ "baseVersion": 6 }
```

#### `POST /api/pomodoro/reset`

请求：

```json
{ "baseVersion": 7 }
```

#### `POST /api/pomodoro/mode`

请求：

```json
{
  "baseVersion": 8,
  "mode": "short_break"
}
```

#### `PUT /api/pomodoro/settings`

请求：

```json
{
  "baseVersion": 9,
  "focusDurationSeconds": 1500,
  "shortBreakDurationSeconds": 300,
  "longBreakDurationSeconds": 900
}
```

#### `GET /api/pomodoro/history?limit=50`

响应：

```json
{
  "sessions": [
    {
      "id": "uuid",
      "userId": "uuid",
      "mode": "focus",
      "plannedDurationSeconds": 1500,
      "actualDurationSeconds": 520,
      "startedAt": "2026-01-01T00:00:00Z",
      "endedAt": "2026-01-01T00:08:40Z",
      "status": "cancelled",
      "createdAt": "2026-01-01T00:00:00Z",
      "updatedAt": "2026-01-01T00:08:40Z"
    }
  ]
}
```

### 并发冲突返回

当 `baseVersion` 与服务端当前版本不一致时返回 `409`：

```json
{
  "error": {
    "code": "state_conflict",
    "message": "state changed on another device",
    "details": {
      "state": { "...latest state..." }
    }
  }
}
```

## 数据同步机制说明

- 所有番茄钟状态都持久化到数据库（`pomodoro_states`）。
- 历史记录持久化到数据库（`pomodoro_sessions`）。
- 前端每 4 秒轮询状态、每 10 秒轮询历史，实现跨设备状态拉取。
- 前端刷新后重新拉取服务端状态，可恢复进行中的番茄钟。
- 使用 `version + baseVersion` 乐观锁避免并发覆盖。
- 后端在读取状态时会自动结算超时完成的进行中会话，保证状态一致性。

## 常用检查命令

```bash
# 后端测试
cd backend && go test ./...

# 前端 lint
cd frontend && npm run lint

# 前端构建
cd frontend && npm run build
```
