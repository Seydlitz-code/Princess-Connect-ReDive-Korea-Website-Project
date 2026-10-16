'use strict';

/**
 * 미래시(Future Sight) 데이터 정규화와 KST 기준 월별 자동 정리(순수 함수).
 */

const FUTURE_SIGHT_MONTH_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const KST_TIMEZONE = 'Asia/Seoul';
const MAX_MONTHS = 36;
const MAX_ENTRIES_PER_CATEGORY = 24;

const kstFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: KST_TIMEZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hour12: false,
});

function getKstDateParts(now = new Date()) {
  const parts = Object.fromEntries(
    kstFormatter
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  );
  if (parts.hour === 24) parts.hour = 0;
  return parts;
}

function currentKoreanYearMonthKey(now = new Date()) {
  const parts = getKstDateParts(now);
  return `${parts.year}-${parts.month}`;
}

function currentKoreanMonthNumber(now = new Date()) {
  return getKstDateParts(now).month;
}

function normalizeMonthNumber(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 12) return null;
  return n;
}

function parseMonthNumber(label) {
  const m = String(label || '').match(/(\d{1,2})\s*월/);
  return m ? normalizeMonthNumber(m[1]) : null;
}

function addMonthsNumber(baseMonth, offset) {
  return ((baseMonth - 1 + offset) % 12) + 1;
}

function monthLabel(monthNumber) {
  return `${monthNumber}월`;
}

function emptyCategories() {
  return { new: [], rerun: [], sixStar: [], unique1: [], unique2: [], event: [] };
}

function defaultFutureSightState(now = new Date()) {
  const monthNumber = currentKoreanMonthNumber(now);
  return {
    version: 1,
    lastMonthCheckedAt: null,
    months: [
      {
        id: 'month-1',
        monthNumber,
        label: monthLabel(monthNumber),
        categories: emptyCategories(),
        info: '',
      },
    ],
  };
}

function normalizeEntries(items) {
  return (Array.isArray(items) ? items : []).slice(0, MAX_ENTRIES_PER_CATEGORY).map((item) => {
    const obj = item && typeof item === 'object' ? item : {};
    let type = obj.type === 'pass' ? 'pass' : obj.type === 'limited' ? 'limited' : 'permanent';
    if (obj.princessPass === true) type = 'pass';
    const base = {
      characterId: String(obj.characterId || '').trim(),
      type,
    };
    if (obj.prizeGacha === true) base.prizeGacha = true;
    if (obj.simultaneousRerun === true) base.simultaneousRerun = true;
    const sg = String(obj.specialGroupId || '').trim().slice(0, 80);
    if (sg) base.specialGroupId = sg;
    return base;
  });
}

function normalizeFutureSightState(value, now = new Date()) {
  const rawMonths = value && typeof value === 'object' && Array.isArray(value.months) ? value.months : [];
  const months = rawMonths.slice(0, MAX_MONTHS).map((month, index) => {
    const src = month && typeof month === 'object' ? month : {};
    const categories = src.categories && typeof src.categories === 'object' ? src.categories : {};
    const monthNumber =
      normalizeMonthNumber(src.monthNumber) ||
      parseMonthNumber(src.label) ||
      addMonthsNumber(currentKoreanMonthNumber(now), index);
    // 구 데이터의 special 카테고리는 event 로 합친다.
    const eventCombined = [...normalizeEntries(categories.event), ...normalizeEntries(categories.special)].slice(
      0,
      MAX_ENTRIES_PER_CATEGORY
    );
    return {
      id: String(src.id || `month-${index + 1}`).trim().slice(0, 80) || `month-${index + 1}`,
      monthNumber,
      label: String(src.label || monthLabel(monthNumber)).trim().slice(0, 20) || monthLabel(monthNumber),
      categories: {
        new: normalizeEntries(categories.new),
        rerun: normalizeEntries(categories.rerun),
        sixStar: normalizeEntries(categories.sixStar),
        unique1: normalizeEntries(categories.unique1),
        unique2: normalizeEntries(categories.unique2),
        event: eventCombined,
      },
      info: String(src.info || '').slice(0, 2000),
    };
  });
  const lastMonthCheckedAt =
    value && typeof value === 'object' && typeof value.lastMonthCheckedAt === 'string'
      ? value.lastMonthCheckedAt
      : null;
  return {
    version: 1,
    lastMonthCheckedAt,
    months: months.length > 0 ? months : defaultFutureSightState(now).months,
  };
}

/**
 * KST 기준 달이 바뀌었거나 마지막 확인 후 24시간이 지났으면 이번 달부터 순서대로 다시 매기고
 * 지난 달 행을 정리한다.
 * @returns {{ state: object, changed: boolean }}
 */
function applyFutureSightMonthMaintenance(value, now = new Date()) {
  const state = normalizeFutureSightState(value, now);
  const lastCheckedMs = state.lastMonthCheckedAt ? Date.parse(state.lastMonthCheckedAt) : NaN;
  const lastCheckedKey = Number.isFinite(lastCheckedMs)
    ? currentKoreanYearMonthKey(new Date(lastCheckedMs))
    : null;
  const monthChanged = !lastCheckedKey || currentKoreanYearMonthKey(now) !== lastCheckedKey;
  if (
    !monthChanged &&
    Number.isFinite(lastCheckedMs) &&
    now.getTime() - lastCheckedMs < FUTURE_SIGHT_MONTH_CHECK_INTERVAL_MS
  ) {
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

  return {
    state: { version: 1, lastMonthCheckedAt: now.toISOString(), months },
    changed: true,
  };
}

/** 다음 KST hh:mm 까지 남은 ms(분 단위 탐색, 최대 24시간) */
function msUntilNextKstClock(hour, minute, now = Date.now()) {
  for (let offsetMs = 60_000; offsetMs <= 86_400_000; offsetMs += 60_000) {
    const parts = getKstDateParts(new Date(now + offsetMs));
    if (parts.hour === hour && parts.minute === minute) return offsetMs;
  }
  return 86_400_000;
}

module.exports = {
  getKstDateParts,
  defaultFutureSightState,
  normalizeFutureSightState,
  applyFutureSightMonthMaintenance,
  msUntilNextKstClock,
};
