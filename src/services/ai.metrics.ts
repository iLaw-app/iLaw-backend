// 상황 진단 요청당 관측 지표를 한 줄 JSON 로그로 남긴다. 별도 APM 없이도
// 토큰(=비용)·구간별 지연·검색/선택 결과·상태를 사후 분석할 수 있게 한다.
//
// 로그 스키마(evt=ai.diagnose):
//   userId, conversationId, status, userRole, crisis, retrievedCount, retrievedIds,
//   selectedIds, step1Tokens, step2Tokens, latencyMs{ retrieve, step1, step2, total }
//
// retrievedIds(검색 후보 순서 그대로)는 "정답 매뉴얼이 후보에 있었는데 라우터가
// 안 골랐는지 / 애초에 검색이 못 찾았는지"를 사후에 가르는 데 필요하다.
// prisma/eval-diagnose.ts 가 같은 정보를 층별 실패 귀속에 사용한다.

import { logger } from '../middlewares/logging';

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
  userRole?: string;
  crisis: boolean;
  retrievedCount: number;
  retrievedIds: number[];
  selectedIds: number[];
  step1Tokens?: number;
  step2Tokens?: number;
  latencyMs: DiagnosisLatency;
}

export function logDiagnosis(metrics: DiagnosisMetrics): void {
  logger.info({ event: 'ai_diagnosis', ...metrics });
}
