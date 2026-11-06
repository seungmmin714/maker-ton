const DAY = 86400000;
const kstDay = value => new Date(value + 9 * 3600000).toISOString().slice(0, 10);

export function recentAnalysisCoverage(records, meals, now = Date.now()) {
  const start = Date.parse(`${kstDay(now)}T00:00:00+09:00`) - 6 * DAY;
  const inPeriod = value => {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && timestamp >= start && timestamp <= now;
  };
  const bowel = records.filter(record => ['stool', 'both'].includes(record.excretion_type) && inPeriod(record.ended_at));
  return {
    bowel_records: bowel.length,
    bowel_days: new Set(bowel.map(record => kstDay(Date.parse(record.ended_at)))).size,
    meal_records: meals.filter(meal => inPeriod(meal.eaten_at)).length,
  };
}

export function isPersonalAI(result) {
  return result?.source === 'ai' && result.status === 'complete';
}

// Reject incompatible responses rather than rendering partial or mislabeled AI output.
export function validatePersonalAnalysis(value) {
  const invalid = () => { throw new Error('분석 결과를 읽지 못했어요. 잠시 후 다시 시도해 주세요.'); };
  const string = (s, limit = 1000) => typeof s === 'string' && s.length > 0 && s.length <= limit;
  if (!value || !['ai', 'rules'].includes(value.source)
    || !['complete', 'insufficient_data', 'unavailable'].includes(value.status)
    || (value.source === 'ai') !== (value.status === 'complete')
    || !string(value.summary) || !Number.isFinite(Date.parse(value.generated_at))
    || !Number.isFinite(Date.parse(value.period?.start)) || !Number.isFinite(Date.parse(value.period?.end))) invalid();
  for (const key of ['bowel_records', 'bowel_days', 'meal_records', 'shape_records', 'sensor_records']) {
    if (!Number.isInteger(value.coverage?.[key]) || value.coverage[key] < 0) invalid();
  }
  if (!Array.isArray(value.evidence) || value.evidence.length > 80
    || !value.evidence.every(item => item && string(item.id, 100) && string(item.label, 200) && string(item.value))) invalid();
  const ids = new Set(value.evidence.map(item => item.id));
  if (ids.size !== value.evidence.length) invalid();
  for (const key of ['observations', 'next_steps']) {
    if (!Array.isArray(value[key]) || value[key].length > 6 || !value[key].every(item => item
      && string(item.title, 200) && string(item.description)
      && Array.isArray(item.evidence_ids) && item.evidence_ids.length > 0
      && item.evidence_ids.every(id => ids.has(id)))) invalid();
  }
  if (!Array.isArray(value.limitations) || value.limitations.length > 10 || !value.limitations.every(item => string(item))) invalid();
  return value;
}

export const emptyPersonalAnalysis = scope => ({ scope, loading: false, result: null, error: '' });

// Kept outside React so account isolation, cancellation and duplicate requests can
// be tested against the exact request coordinator used by both screens.
export function createPersonalAnalysisController(request, onChange) {
  let context = null;
  let pending = null;
  let generation = 0;
  let state = emptyPersonalAnalysis('');
  const emit = next => { state = next; onChange(next); };
  const invalidate = () => {
    generation += 1;
    pending?.abort();
    pending = null;
    context = null;
  };
  return {
    setContext(userId, scope) {
      if (context?.userId === userId && context?.scope === scope) return;
      invalidate(); context = { userId, scope }; emit(emptyPersonalAnalysis(scope));
    },
    dispose: invalidate,
    async run(scope) {
      if (!context?.userId || context.scope !== scope || pending) return;
      const current = generation;
      const userId = context.userId;
      const controller = new AbortController(); pending = controller;
      emit({ ...state, loading: true, error: '' });
      const active = () => generation === current && !controller.signal.aborted;
      try {
        const value = await request('/insights/analyze', {
          method: 'POST', body: {}, signal: controller.signal, expectedUserId: userId,
        });
        if (!active()) return;
        const result = validatePersonalAnalysis(value);
        emit({ scope, loading: false, result, error: '' });
      } catch (error) {
        if (!active() || error?.name === 'AbortError') return;
        if (error?.status === 401) {
          emit(emptyPersonalAnalysis(scope));
          return; // api.js already sends the app back to login.
        }
        const message = error?.status === 404
          ? 'AI 분석 기능을 연결하고 있어요. 기록 요약은 변화 보기에서 확인할 수 있어요.'
          : error?.status === 429
            ? '잠시 뒤 다시 분석해 주세요. 짧은 시간에 요청이 많았어요.'
            : 'AI 분석을 완료하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.';
        emit({ ...state, loading: false, error: message });
      } finally {
        if (active()) pending = null;
      }
    },
  };
}
