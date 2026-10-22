/**
 * 미래시(Future Sight) 데이터 정규화와 KST 기준 월별 자동 정리 (기존 lib/futureSight.js 이식, 순수 함수).
 * 기존 서버는 매일 KST 00:05 타이머로 정리했지만, Workers에서는 Cron(wrangler.jsonc triggers)이 맡는다.
 */

/** 같은 달이어도 마지막 확인 후 24시간이 지나면 다시 정리한다. */
const MONTH_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const KST_TIMEZONE = 'Asia/Seoul';
/** 저장할 수 있는 달 수: 36개월 */
const MAX_MONTHS = 36;
/** 카테고리 하나에 넣을 수 있는 캐릭터 수: 24명 */
const MAX_ENTRIES_PER_CATEGORY = 24;
/** 달 id 최대 길이: 80자 */
const MONTH_ID_MAX = 80;
/** 달 이름 최대 길이: 20자 */
const MONTH_LABEL_MAX = 20;
/** 달 안내문 최대 길이: 2000자 */
const MONTH_INFO_MAX = 2000;

export const CATEGORY_KEYS = ['new', 'rerun', 'sixStar', 'unique1', 'unique2', 'event'] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export type FutureSightEntry = {
  characterId: string;
  type: 'pass' | 'limited' | 'permanent';
  prizeGacha?: true;
  simultaneousRerun?: true;
  specialGroupId?: string;
};

export type FutureSightMonth = {
  id: string;
  monthNumber: number;
  label: string;
  categories: Record<CategoryKey, FutureSightEntry[]>;
  info: string;
};

export type FutureSightState = {
  version: 1;
  lastMonthCheckedAt: string | null;
  months: FutureSightMonth[];
};

type KstDateParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const kstFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: KST_TIMEZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hour12: false
});

export function getKstDateParts(now = new Date()): KstDateParts {
  const parts: Record<string, number> = {};
  for (const part of kstFormatter.formatToParts(now)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  // 일부 환경은 자정을 24시로 표시한다.
  if (parts.hour === 24) parts.hour = 0;
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second
  };
}

function currentKoreanYearMonthKey(now: Date): string {
  const parts = getKstDateParts(now);
  return `${parts.year}-${parts.month}`;
}

function currentKoreanMonthNumber(now: Date): number {
  return getKstDateParts(now).month;
}

function normalizeMonthNumber(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 12) return null;
  return n;
}

function parseMonthNumber(label: unknown): number | null {
  const match = String(label || '').match(/(\d{1,2})\s*월/);
  return match ? normalizeMonthNumber(match[1]) : null;
}

function addMonthsNumber(baseMonth: number, offset: number): number {
  return ((baseMonth - 1 + offset) % 12) + 1;
}

function monthLabel(monthNumber: number): string {
  return `${monthNumber}월`;
}

function emptyCategories(): Record<CategoryKey, FutureSightEntry[]> {
  return { new: [], rerun: [], sixStar: [], unique1: [], unique2: [], event: [] };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function defaultFutureSightState(now = new Date()): FutureSightState {
  const monthNumber = currentKoreanMonthNumber(now);
  return {
    version: 1,
    lastMonthCheckedAt: null,
    months: [{ id: 'month-1', monthNumber, label: monthLabel(monthNumber), categories: emptyCategories(), info: '' }]
  };
}

function normalizeEntries(items: unknown): FutureSightEntry[] {
  return (Array.isArray(items) ? items : []).slice(0, MAX_ENTRIES_PER_CATEGORY).map((item) => {
    const obj = asRecord(item);
    let type: FutureSightEntry['type'] = obj.type === 'pass' ? 'pass' : obj.type === 'limited' ? 'limited' : 'permanent';
    if (obj.princessPass === true) type = 'pass';
    const entry: FutureSightEntry = { characterId: String(obj.characterId || '').trim(), type };
    if (obj.prizeGacha === true) entry.prizeGacha = true;
    if (obj.simultaneousRerun === true) entry.simultaneousRerun = true;
    const specialGroupId = String(obj.specialGroupId || '').trim().slice(0, MONTH_ID_MAX);
    if (specialGroupId) entry.specialGroupId = specialGroupId;
    return entry;
  });
}

export function normalizeFutureSightState(value: unknown, now = new Date()): FutureSightState {
  const source = asRecord(value);
  const rawMonths = Array.isArray(source.months) ? source.months : [];
  const months = rawMonths.slice(0, MAX_MONTHS).map((rawMonth, index): FutureSightMonth => {
    const month = asRecord(rawMonth);
    const categories = asRecord(month.categories);
    const monthNumber =
      normalizeMonthNumber(month.monthNumber) ||
      parseMonthNumber(month.label) ||
      addMonthsNumber(currentKoreanMonthNumber(now), index);
    // 구 데이터의 special 카테고리는 event로 합친다.
    const eventCombined = [...normalizeEntries(categories.event), ...normalizeEntries(categories.special)].slice(
      0,
      MAX_ENTRIES_PER_CATEGORY
    );
    const fallbackId = `month-${index + 1}`;
    return {
      id: String(month.id || fallbackId).trim().slice(0, MONTH_ID_MAX) || fallbackId,
      monthNumber,
      label: String(month.label || monthLabel(monthNumber)).trim().slice(0, MONTH_LABEL_MAX) || monthLabel(monthNumber),
      categories: {
        new: normalizeEntries(categories.new),
        rerun: normalizeEntries(categories.rerun),
        sixStar: normalizeEntries(categories.sixStar),
        unique1: normalizeEntries(categories.unique1),
        unique2: normalizeEntries(categories.unique2),
        event: eventCombined
      },
      info: String(month.info || '').slice(0, MONTH_INFO_MAX)
    };
  });
  return {
    version: 1,
    lastMonthCheckedAt: typeof source.lastMonthCheckedAt === 'string' ? source.lastMonthCheckedAt : null,
    months: months.length > 0 ? months : defaultFutureSightState(now).months
  };
}

/**
 * KST 기준 달이 바뀌었거나 마지막 확인 후 24시간이 지났으면 이번 달부터 순서대로 다시 매기고
 * 지난 달 행을 정리한다.
 */
export function applyFutureSightMonthMaintenance(
  value: unknown,
  now = new Date()
): { state: FutureSightState; changed: boolean } {
  const state = normalizeFutureSightState(value, now);
  const lastCheckedMs = state.lastMonthCheckedAt ? Date.parse(state.lastMonthCheckedAt) : NaN;
  const lastCheckedKey = Number.isFinite(lastCheckedMs) ? currentKoreanYearMonthKey(new Date(lastCheckedMs)) : null;
  const isMonthChanged = !lastCheckedKey || currentKoreanYearMonthKey(now) !== lastCheckedKey;
  if (!isMonthChanged && Number.isFinite(lastCheckedMs) && now.getTime() - lastCheckedMs < MONTH_CHECK_INTERVAL_MS) {
    return { state, changed: false };
  }

  const currentMonth = currentKoreanMonthNumber(now);
  let months = state.months;
  const currentIndex = months.findIndex(
    (month) => month.monthNumber === currentMonth || parseMonthNumber(month.label) === currentMonth
  );
  if (currentIndex > 0) months = months.slice(currentIndex);
  if (months.length === 0) months = defaultFutureSightState(now).months;
  months = months.map((month, index) => {
    const monthNumber = addMonthsNumber(currentMonth, index);
    return { ...month, monthNumber, label: monthLabel(monthNumber) };
  });

  return { state: { version: 1, lastMonthCheckedAt: now.toISOString(), months }, changed: true };
}
