// 상황 진단 요청당 관측 지표를 한 줄 JSON 로그로 남긴다. 별도 APM 없이도
// 토큰(=비용)·구간별 지연·검색/선택 결과·상태를 사후 분석할 수 있게 한다.
//
// 로그 스키마(evt=ai.diagnose):
//   userId, conversationId, status, crisis, retrievedCount, selectedIds,
//   step1Tokens, step2Tokens, latencyMs{ retrieve, step1, step2, total }

export interface DiagnosisLatency {
  retrieve: number;
  step1: number;
  step2: number;
  total: number;
}

export interface DiagnosisMetrics {
  userId?: string;
  conversationId?: string;
  status: string;
  crisis: boolean;
  retrievedCount: number;
  selectedIds: number[];
  step1Tokens?: number;
  step2Tokens?: number;
  latencyMs: DiagnosisLatency;
}

export function logDiagnosis(metrics: DiagnosisMetrics): void {
  // 구조화 로그: 수집기(예: Railway logs)가 JSON으로 파싱할 수 있게 한 줄로.
  console.log(JSON.stringify({ evt: 'ai.diagnose', ...metrics }));
}
