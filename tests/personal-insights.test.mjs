import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonalAnalysisController, recentAnalysisCoverage, validatePersonalAnalysis, isPersonalAI } from '../app/src/personal-insights.js';

const now = Date.parse('2026-11-07T00:30:00+09:00');
const result = overrides => ({
  source: 'ai', status: 'complete', generated_at: new Date(now).toISOString(),
  period: { start: '2026-10-31T15:00:00.000Z', end: new Date(now).toISOString() },
  coverage: { bowel_records: 4, bowel_days: 3, meal_records: 7, shape_records: 3, sensor_records: 2 },
  summary: '최근 기록에서 모양과 시간을 함께 돌아볼 수 있어요.',
  observations: [{ title: '모양 기록', description: '모양을 3번 남겼어요.', evidence_ids: ['shape'] }],
  next_steps: [{ title: '다음 모양 기록', description: '다음 기록에도 모양을 함께 남겨주세요.', evidence_ids: ['shape'] }],
  evidence: [{ id: 'shape', label: '모양 기록', value: '3회' }], limitations: ['직접 남긴 기록만 분석해요.'],
  ...overrides,
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

test('readiness counts only bowel records in the latest seven KST calendar days, ignoring future/invalid dates', () => {
  const record = (ended_at, excretion_type = 'stool') => ({ ended_at, excretion_type });
  const records = [
    record('2026-10-31T14:59:59Z'), // October 31 in KST, outside window.
    record('2026-10-31T15:00:00Z'), // November 1, start of window.
    record('2026-11-05T14:59:59Z'), // November 5 in KST.
    record('2026-11-05T15:00:00Z', 'both'), // November 6 in KST.
    record('2026-11-06T15:00:00Z', 'urine'), record('2026-11-06T15:01:00Z', 'unknown'),
    record('2026-11-07T00:31:00+09:00'), record('invalid'),
  ];
  const meals = [{ eaten_at: '2026-11-06T20:00:00+09:00' }, { eaten_at: '2026-11-08T08:00:00+09:00' }];
  assert.deepEqual(recentAnalysisCoverage(records, meals, now), { bowel_records: 3, bowel_days: 3, meal_records: 1 });
  assert.equal(recentAnalysisCoverage([...records, records[1]], meals, now).bowel_days, 3);
});

test('only complete provider output is labeled AI; invalid status/evidence is rejected', () => {
  assert.equal(isPersonalAI(validatePersonalAnalysis(result())), true);
  const fallback = result({ source: 'rules', status: 'unavailable' });
  assert.equal(isPersonalAI(validatePersonalAnalysis(fallback)), false);
  assert.throws(() => validatePersonalAnalysis(result({ status: 'unavailable' })));
  assert.throws(() => validatePersonalAnalysis(result({ observations: [{ title: '제목', description: '내용', evidence_ids: ['invented'] }] })));
  assert.throws(() => validatePersonalAnalysis(result({ coverage: { bowel_records: -1 } })));
});

test('analysis is explicit, sends no records/user ID body, and suppresses duplicate clicks', async () => {
  const wait = deferred(), calls = [], states = [];
  const controller = createPersonalAnalysisController((...args) => { calls.push(args); return wait.promise; }, state => states.push(state));
  controller.setContext('person-a', 'a:1');
  assert.equal(calls.length, 0);
  const first = controller.run('a:1');
  await controller.run('a:1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/insights/analyze');
  assert.deepEqual(calls[0][1].body, {});
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].expectedUserId, 'person-a');
  assert.equal(states.at(-1).loading, true);
  wait.resolve(result()); await first;
  assert.equal(states.at(-1).result.source, 'ai');
  assert.equal(states.at(-1).loading, false);
});

test('a late response from the previous account never becomes visible', async () => {
  const wait = deferred(), states = []; let signal;
  const controller = createPersonalAnalysisController((_path, options) => { signal = options.signal; return wait.promise; }, state => states.push(state));
  controller.setContext('person-a', 'a:1');
  const pending = controller.run('a:1');
  controller.setContext('person-b', 'b:1');
  assert.equal(signal.aborted, true);
  const snapshot = [...states];
  wait.resolve(result()); await pending;
  assert.deepEqual(states, snapshot);
  assert.equal(states.at(-1).result, null);
  assert.equal(states.at(-1).scope, 'b:1');
});

test('record edits, day rollover, logout and unmount invalidate pending analysis, even if transport ignores abort', async () => {
  for (const change of ['revision', 'day', 'logout', 'unmount']) {
    const wait = deferred(), states = []; let signal;
    const controller = createPersonalAnalysisController((_path, options) => { signal = options.signal; return wait.promise; }, state => states.push(state));
    controller.setContext('person-a', 'a:1:2026-11-06');
    const pending = controller.run('a:1:2026-11-06');
    if (change === 'revision') controller.setContext('person-a', 'a:2:2026-11-06');
    if (change === 'day') controller.setContext('person-a', 'a:1:2026-11-07');
    if (change === 'logout') controller.setContext(undefined, ':1:2026-11-06');
    if (change === 'unmount') controller.dispose();
    assert.equal(signal.aborted, true, change);
    const length = states.length;
    wait.resolve(result()); await pending;
    assert.equal(states.length, length, change);
  }
});

test('stale clicks do nothing and a replacement request is not cancelled by the old request finishing', async () => {
  const first = deferred(), second = deferred(), states = [], calls = [];
  const controller = createPersonalAnalysisController((_path, options) => { calls.push(options); return calls.length === 1 ? first.promise : second.promise; }, state => states.push(state));
  controller.setContext('person-a', 'a:1'); const old = controller.run('a:1');
  controller.setContext('person-a', 'a:2');
  await controller.run('a:1');
  assert.equal(calls.length, 1);
  const current = controller.run('a:2');
  first.resolve(result()); await old;
  await controller.run('a:2');
  assert.equal(calls.length, 2);
  second.resolve(result({ summary: '새 기록 분석' })); await current;
  assert.equal(states.at(-1).result.summary, '새 기록 분석');
});

test('401 clears analysis without a fake fallback; other failures keep prior result and permit retry', async () => {
  const states = []; let response = result();
  const controller = createPersonalAnalysisController(async () => { if (response instanceof Error) throw response; return response; }, state => states.push(state));
  controller.setContext('person-a', 'a:1');
  await controller.run('a:1');
  response = Object.assign(new Error('private provider details'), { status: 503 });
  await controller.run('a:1');
  assert.equal(states.at(-1).result.source, 'ai');
  assert.equal(states.at(-1).error.includes('private'), false);
  assert.equal(states.at(-1).loading, false);
  response = result({ source: 'rules', status: 'unavailable' });
  await controller.run('a:1');
  assert.equal(states.at(-1).result.source, 'rules');
  response = Object.assign(new Error('expired'), { status: 401 });
  await controller.run('a:1');
  assert.equal(states.at(-1).result, null);
  assert.equal(states.at(-1).error, '');
});

test('missing endpoint or malformed response shows a recoverable error and never a false AI badge', async () => {
  const states = []; let failure = true;
  const controller = createPersonalAnalysisController(async () => {
    if (failure) throw Object.assign(new Error('not found'), { status: 404 });
    return { source: 'ai' };
  }, state => states.push(state));
  controller.setContext('person-a', 'a:1');
  await controller.run('a:1');
  assert.match(states.at(-1).error, /연결하고/);
  assert.equal(states.at(-1).result, null);
  failure = false;
  await controller.run('a:1');
  assert.match(states.at(-1).error, /완료하지/);
  assert.equal(states.at(-1).result, null);
});
