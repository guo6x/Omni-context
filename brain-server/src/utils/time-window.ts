// 时间词召回：从自然语言查询里识别"昨天/上周/这个月"等时间表达，算出一个时间窗口。
// 返回的 start/end 为 UTC ISO（end 为开区间上界），用于按 created_at 过滤实体。
// 以本地时区计算日界，再转 UTC（实体 created_at 存的是 UTC ISO）。

export interface TimeWindow {
  start: string; // inclusive, UTC ISO
  end: string;   // exclusive, UTC ISO
  label: string;
}

function dayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function iso(d: Date): string {
  return d.toISOString();
}

export function parseTimeWindow(query: string, now: Date = new Date()): TimeWindow | null {
  const q = (query || '').toLowerCase();
  const today0 = dayStart(now);

  const win = (startDay: Date, endDay: Date, label: string): TimeWindow => ({
    start: iso(startDay),
    end: iso(endDay),
    label,
  });

  // 具体单日
  if (/前天/.test(q)) return win(addDays(today0, -2), addDays(today0, -1), '前天');
  if (/昨[天日]/.test(q)) return win(addDays(today0, -1), today0, '昨天');
  if (/今[天日]|刚才|刚刚/.test(q)) return win(today0, addDays(today0, 1), '今天');

  // 最近 N 天 / 前几天 / 这几天 / 最近几天
  const nDays = q.match(/(?:最近|过去|近)\s*(\d+)\s*天/);
  if (nDays) {
    const n = Math.max(1, Math.min(365, parseInt(nDays[1], 10)));
    return win(addDays(today0, -(n - 1)), addDays(today0, 1), `最近${n}天`);
  }
  if (/(最近几天|这几天|前几天|近几天)/.test(q)) {
    return win(addDays(today0, -6), addDays(today0, 1), '最近几天');
  }

  // 周：本周一为界
  const dow = (now.getDay() + 6) % 7; // 周一=0
  const thisMon = addDays(today0, -dow);
  if (/(上上周|上上星期)/.test(q)) return win(addDays(thisMon, -14), addDays(thisMon, -7), '上上周');
  if (/(上周|上星期|上个星期)/.test(q)) return win(addDays(thisMon, -7), thisMon, '上周');
  if (/(本周|这周|这星期|这个星期)/.test(q)) return win(thisMon, addDays(thisMon, 7), '本周');

  // 月
  const thisMonth0 = new Date(now.getFullYear(), now.getMonth(), 1);
  if (/(上个月|上月)/.test(q)) {
    const lastMonth0 = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return win(lastMonth0, thisMonth0, '上个月');
  }
  if (/(这个月|本月)/.test(q)) {
    return win(thisMonth0, new Date(now.getFullYear(), now.getMonth() + 1, 1), '这个月');
  }

  // 年
  const thisYear0 = new Date(now.getFullYear(), 0, 1);
  if (/去年/.test(q)) return win(new Date(now.getFullYear() - 1, 0, 1), thisYear0, '去年');
  if (/今年/.test(q)) return win(thisYear0, new Date(now.getFullYear() + 1, 0, 1), '今年');

  return null;
}
