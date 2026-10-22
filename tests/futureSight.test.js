'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getKstDateParts,
  normalizeFutureSightState,
  applyFutureSightMonthMaintenance,
  msUntilNextKstClock,
} = require('../lib/futureSight');

const month = (n, extra = {}) => ({ id: `m${n}`, monthNumber: n, label: `${n}월`, categories: {}, ...extra });

test('KST 날짜 계산(UTC 15시 = KST 다음날 0시)', () => {
  const p = getKstDateParts(new Date('2026-10-31T15:30:00Z'));
  assert.deepEqual([p.year, p.month, p.day, p.hour, p.minute], [2026, 11, 1, 0, 30]);
});

test('달이 바뀌면 지난 달을 지우고 이번 달부터 다시 매긴다', () => {
  const now = new Date('2026-11-01T00:10:00+09:00');
  const { state, changed } = applyFutureSightMonthMaintenance(
    { months: [month(10, { info: '지난달' }), month(11, { info: '이번달' }), month(12)], lastMonthCheckedAt: '2026-10-20T00:00:00Z' },
    now
  );
  assert.equal(changed, true);
  assert.deepEqual(state.months.map((m) => m.label), ['11월', '12월']);
  assert.equal(state.months[0].info, '이번달');
  assert.equal(state.lastMonthCheckedAt, now.toISOString());
});

test('같은 달 24시간 이내 재확인은 변경하지 않는다', () => {
  const now = new Date('2026-11-05T12:00:00+09:00');
  const value = { months: [month(11)], lastMonthCheckedAt: new Date(now.getTime() - 60_000).toISOString() };
  assert.equal(applyFutureSightMonthMaintenance(value, now).changed, false);
});

test('이번 달이 목록에 없으면 이번 달부터 연속으로 다시 매긴다', () => {
  const now = new Date('2027-01-10T09:00:00+09:00');
  const { state } = applyFutureSightMonthMaintenance({ months: [month(5), month(6)] }, now);
  assert.deepEqual(state.months.map((m) => m.monthNumber), [1, 2]);
});

test('정규화: 구 special 카테고리 병합, 개수·길이 제한', () => {
  const entries = Array.from({ length: 30 }, (_, i) => ({ characterId: `c${i}`, type: 'limited' }));
  const s = normalizeFutureSightState({
    months: [{ ...month(3), label: 'x'.repeat(50), categories: { new: entries, special: [{ characterId: 's', princessPass: true }] } }],
  });
  assert.equal(s.months[0].categories.new.length, 24);
  assert.deepEqual(s.months[0].categories.event, [{ characterId: 's', type: 'pass' }]);
  assert.equal(s.months[0].label.length, 20);
});

test('다음 KST 00:05 까지 남은 시간', () => {
  const now = new Date('2026-10-17T00:00:00+09:00').getTime();
  assert.equal(msUntilNextKstClock(0, 5, now), 5 * 60_000);
});
