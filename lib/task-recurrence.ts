import type { Task } from "@/lib/types";

const WEEK_DAYS: Record<string, number> = {
  seg: 1,
  ter: 2,
  qua: 3,
  qui: 4,
  sex: 5,
};

export const getTodayStr = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

export const formatToBR = (dateStr: string) => {
  if (!dateStr || dateStr === "1970-01-01" || dateStr.includes("/")) return dateStr;
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
};

export const getLastOccurrence = (task: Task) => {
  const todayStr = getTodayStr();
  const createdAtStr = task.created_at.split("T")[0];

  if (!task.repeat_days || task.repeat_days === "") return task.last_done_date || "1970-01-01";

  let theoreticalLastStr = "1970-01-01";

  const dayOfMonth = parseInt(task.repeat_days);
  if (!isNaN(dayOfMonth) && !task.repeat_days.includes(",")) {
    const today = new Date();
    const thisMonthOcc = new Date(today.getFullYear(), today.getMonth(), dayOfMonth);
    const lastMonthOcc = new Date(today.getFullYear(), today.getMonth() - 1, dayOfMonth);

    const targetDate = today.getDate() >= dayOfMonth ? thisMonthOcc : lastMonthOcc;
    theoreticalLastStr = targetDate.toISOString().split("T")[0];
  } else {
    const taskDays = task.repeat_days.split(",").map((d: string) => WEEK_DAYS[d as keyof typeof WEEK_DAYS]);
    const startDate = new Date(task.created_at);
    const startMonday = new Date(startDate);
    startMonday.setDate(startDate.getDate() - (startDate.getDay() === 0 ? 6 : startDate.getDay() - 1));

    for (let w = 0; w < 52; w++) {
      if (w % (task.repeat_interval || 1) === 0) {
        const currWeekMon = new Date(startMonday);
        currWeekMon.setDate(startMonday.getDate() + w * 7);
        for (const dayOffset of taskDays) {
          const occurrence = new Date(currWeekMon);
          occurrence.setDate(currWeekMon.getDate() + (dayOffset - 1));
          const occStr = occurrence.toISOString().split("T")[0];
          if (occStr <= todayStr && occStr > theoreticalLastStr) theoreticalLastStr = occStr;
        }
      }
      const nextW = new Date(startMonday);
      nextW.setDate(startMonday.getDate() + (w + 1) * 7);
      if (nextW.toISOString().split("T")[0] > todayStr) break;
    }
  }

  if (theoreticalLastStr < createdAtStr) {
    const nextOccBR = getNextOccurrence(task);
    const [d, m, y] = nextOccBR.split("/");
    return `${y}-${m}-${d}`;
  }

  return theoreticalLastStr;
};

export const getNextOccurrence = (task: Task) => {
  const today = new Date();
  const todayStr = getTodayStr();
  if (!task.repeat_days || task.repeat_days === "") return "--/--/----";

  const dayOfMonth = parseInt(task.repeat_days);
  if (!isNaN(dayOfMonth) && !task.repeat_days.includes(",")) {
    const thisMonthOcc = new Date(today.getFullYear(), today.getMonth(), dayOfMonth);
    const nextMonthOcc = new Date(today.getFullYear(), today.getMonth() + (task.repeat_interval || 1), dayOfMonth);
    const nextDate = today.getDate() < dayOfMonth ? thisMonthOcc : nextMonthOcc;
    return formatToBR(nextDate.toISOString().split("T")[0]);
  }

  const taskDays = task.repeat_days.split(",").map((d: string) => WEEK_DAYS[d as keyof typeof WEEK_DAYS]);
  const startDate = new Date(task.created_at);
  const startMonday = new Date(startDate);
  startMonday.setDate(startDate.getDate() - (startDate.getDay() === 0 ? 6 : startDate.getDay() - 1));

  for (let w = 0; w < 52; w += task.repeat_interval || 1) {
    const currMon = new Date(startMonday);
    currMon.setDate(startMonday.getDate() + w * 7);
    for (const dayOffset of taskDays) {
      const occ = new Date(currMon);
      occ.setDate(currMon.getDate() + (dayOffset - 1));
      const occStr = occ.toISOString().split("T")[0];
      if (occStr >= todayStr) return formatToBR(occStr);
    }
  }

  return "--/--/----";
};
