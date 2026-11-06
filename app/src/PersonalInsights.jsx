import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { api } from './api';
import { Badge, ErrorMessage, Icon } from './UI';
import { createPersonalAnalysisController, emptyPersonalAnalysis, isPersonalAI, recentAnalysisCoverage } from './personal-insights';

export function usePersonalInsights(userId, revision, today) {
  const scope = `${userId || ''}:${revision}:${today}`;
  const [state, setState] = useState(() => emptyPersonalAnalysis(scope));
  const controller = useRef(null);
  if (!controller.current) controller.current = createPersonalAnalysisController(api, setState);
  useLayoutEffect(() => {
    controller.current.setContext(userId, scope);
    return () => controller.current.dispose();
  }, [userId, scope]);
  const analyze = useCallback(() => controller.current.run(scope), [scope]);
  // A changed identity/revision must never briefly show the preceding result.
  return { ...(state.scope === scope ? state : emptyPersonalAnalysis(scope)), analyze };
}

const displayDate = value => new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric',
}).format(new Date(value));

function EvidenceLinks({ ids, evidence }) {
  const selected = evidence.filter(item => ids.includes(item.id));
  return <details className="personal-evidence"><summary>이렇게 판단한 기록</summary><dl>{selected.map(item => <div key={item.id}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl></details>;
}

export default function PersonalInsights({ analysis, records, meals, loading, aiEnabled, online, compact = false, onDetails }) {
  const { result, error, analyze } = analysis;
  const pending = analysis.loading;
  const coverage = result?.coverage || recentAnalysisCoverage(records, meals);
  const enough = coverage.bowel_records >= 3 && coverage.bowel_days >= 3;
  const available = aiEnabled !== false;
  const disabled = pending || loading || !online || !available || !enough;
  const ai = isPersonalAI(result);
  const buttonText = pending ? '내 기록을 함께 분석하고 있어요…'
    : result ? '내 기록 다시 분석하기' : '내 기록 AI 분석하기';
  return <section className={`personal-analysis${compact ? ' is-compact' : ''}`} aria-label="개인 맞춤형 배변 AI 분석" aria-busy={pending}>
    <div className="personal-analysis-heading"><span className="eyebrow"><Icon name="leaf" size={16}/>나만의 패턴 찾기</span><Badge>{result ? ai ? 'AI 분석' : '기록 요약' : '내 기록으로'}</Badge></div>
    <h2>개인 맞춤형 배변 AI 분석</h2>
    {result ? <>
      <p className="personal-summary">{result.summary}</p>
      <p className="personal-coverage">{displayDate(result.period.start)}–{displayDate(result.period.end)} · 배변 {coverage.bowel_records}회 · 식사 {coverage.meal_records}끼</p>
      {result.status === 'unavailable' && <p className="personal-status">AI 연결이 원활하지 않아 기록 요약을 보여드려요.</p>}
      {compact ? <>
        {result.next_steps[0] && <div className="personal-first-step"><strong>{result.next_steps[0].title}</strong><p>{result.next_steps[0].description}</p></div>}
        <button className="text-button" onClick={onDetails}>분석 결과 자세히 보기<Icon name="chevron" size={15}/></button>
      </> : <>
        {result.observations.length > 0 && <div className="personal-result-group"><h3>내 기록에서 발견했어요</h3>{result.observations.map((item, index) => <article className="personal-observation" key={index}><h4>{item.title}</h4><p>{item.description}</p><EvidenceLinks ids={item.evidence_ids} evidence={result.evidence}/></article>)}</div>}
        {result.next_steps.length > 0 && <div className="personal-result-group"><h3>다음 기록에서 확인해 봐요</h3><ol className="personal-next-steps">{result.next_steps.map((item, index) => <li key={index}><span className="personal-step-number">{index + 1}</span><div><h4>{item.title}</h4><p>{item.description}</p><EvidenceLinks ids={item.evidence_ids} evidence={result.evidence}/></div></li>)}</ol></div>}
        {result.limitations.length > 0 && <details className="personal-evidence personal-limitations"><summary>분석 범위와 참고 사항</summary><ul>{result.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul><p>생활 기록을 돌아보는 분석이며, 질병을 진단하지 않아요.</p></details>}
        <p className="personal-generated">{displayDate(result.generated_at)} {new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(result.generated_at))} 분석</p>
      </>}
    </> : <>
      <p className="personal-summary">배변 모양·사용 시간과 식사 기록을 함께 살펴보고, 내 패턴과 다음에 확인할 점을 알려드려요.</p>
      {!loading && <p className="personal-coverage">최근 7일 · 배변 {coverage.bowel_records}회 / {coverage.bowel_days}일 · 식사 {coverage.meal_records}끼</p>}
      {!loading && !enough && <p className="personal-status">서로 다른 3일에 배변 기록을 남기면 분석할 수 있어요. {Math.max(0, 3 - coverage.bowel_days)}일 더 모아주세요.</p>}
    </>}
    {!available && <p className="personal-status">AI 연결을 준비하고 있어요. 현재 기록 요약은 변화 보기에서 확인할 수 있어요.</p>}
    {!online && <p className="personal-status">인터넷에 연결하면 분석할 수 있어요.</p>}
    <ErrorMessage>{error}</ErrorMessage>
    {(!compact || !result || error) && <>
      <p className="personal-disclosure">분석 버튼을 누르면 이름·이메일·사진을 제외한 기록 요약을 Anthropic AI에 보내요.</p>
      <button type="button" className="primary-button" onClick={analyze} disabled={disabled}>{loading ? '기록을 불러오고 있어요…' : buttonText}{!pending && <Icon name="chevron" size={16}/>}</button>
    </>}
    {compact && !result && <button className="text-button personal-details-button" onClick={onDetails}>내 기록 요약 보기<Icon name="chevron" size={15}/></button>}
    {pending && <p role="status" className="personal-status personal-loading">배변과 식사 기록의 흐름을 함께 살펴보고 있어요. 잠시만 기다려 주세요.</p>}
  </section>;
}
