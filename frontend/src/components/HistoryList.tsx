import type { PomodoroSession } from "../types";

type Props = {
  sessions: PomodoroSession[];
};

const modeMap: Record<PomodoroSession["mode"], string> = {
  focus: "专注",
  short_break: "短休息",
  long_break: "长休息",
};

const statusMap: Record<PomodoroSession["status"], string> = {
  running: "进行中",
  completed: "完成",
  cancelled: "取消",
};

function formatDateTime(value: string | undefined): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  return date.toLocaleString();
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

export function HistoryList({ sessions }: Props) {
  return (
    <section className="panel">
      <h3>历史记录</h3>
      {sessions.length === 0 ? (
        <p className="subtle">暂无记录</p>
      ) : (
        <div className="history-list">
          <table>
            <thead>
              <tr>
                <th>模式</th>
                <th>状态</th>
                <th>计划时长</th>
                <th>实际时长</th>
                <th>开始时间</th>
                <th>结束时间</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id}>
                  <td>{modeMap[session.mode]}</td>
                  <td>{statusMap[session.status]}</td>
                  <td>{formatDuration(session.plannedDurationSeconds)}</td>
                  <td>{formatDuration(session.actualDurationSeconds)}</td>
                  <td>{formatDateTime(session.startedAt)}</td>
                  <td>{formatDateTime(session.endedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
