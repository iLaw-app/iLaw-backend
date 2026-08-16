# 상황 진단 AI 정확도 평가 (ai:eval)

프로덕션 진단 로직(`retrieveCandidates → 라우터(gpt-4o) → 생성(gpt-4o-mini)`)을 골든 케이스로
e2e 실행해 층별 정확도를 재고, 프롬프트·검색을 바꿀 때 회귀를 잡는다.

## 파일

| 경로 | 역할 |
| --- | --- |
| `prisma/eval/diagnose-cases.json` | 골든 케이스(현재 125건). 매뉴얼은 **제목 문자열**로 참조(id churn 무관) |
| `prisma/eval/diagnose-scoring.ts` | 순수 채점 로직(층별 실패 귀속·집계·게이트·비교). 유닛 테스트 `tests/ai.eval-scoring.test.ts` |
| `prisma/eval-diagnose.ts` | 러너. 로컬 DB + 실제 OpenAI 로 실행, `eval-results/` 에 JSON 저장 |
| `prisma/eval/retrieval-lab.ts` | 검색 전략 실험실(LLM 없이 임베딩만) — 모델/융합 비교 |
| `eval-results/diagnose-baseline.json` | 비교 기준(git 추적). 나머지 결과 파일은 로컬 전용 |

## 실행

```bash
npm run ai:eval                                   # 전체 125건, 베이스라인과 비교
npm run ai:eval -- --only=unrelated,knowledge     # 태그 필터(OR)
npm run ai:eval -- --id=sch-perp-01 --verbose     # 단일 케이스 + 후보/요약 출력
npm run ai:eval -- --hybrid=off                   # 렉시컬 단독 A/B
npm run ai:eval -- --save-baseline                # 이번(전체·무오류) 결과를 베이스라인으로
npm run ai:eval:gate                              # 임계치 미달 시 exit 1
```

- 전제: 로컬 DB에 매뉴얼 적재 + 임베딩(`npm run migrate:local` 이 임베딩까지 자동 실행), `OPENAI_API_KEY`.
- 비용: 케이스당 gpt-4o 1회 + gpt-4o-mini ≤1회 + 임베딩 2회. 전체 ≈ $1 미만.
- 동시성 기본 2. OpenAI 조직 TPM(gpt-4o 30k/분)에 걸리면 429 → 러너가 안내된 대기 후 재시도한다.
  크레딧 소진/쿼터 오류는 재시도 없이 즉시 중단한다(그 결과는 베이스라인으로 저장되지 않음).

## 지표와 실패 층

| 층 | 의미 | 손볼 곳 |
| --- | --- | --- |
| `router-status` | relevant/unrelated 분류 오류 | `ai.prompts.ts` 라우터 1번 규칙 |
| `retrieval` | 정답 매뉴얼이 후보 top-K(12)에 없음 | `ai.retrieval.ts`, 임베딩 모델, 동의어, 매뉴얼 콘텐츠 공백 |
| `router-selection` | 후보엔 있는데 안 고름 / 금지 매뉴얼 선택 | 라우터 2-c 규칙(유형·관점) |
| `crisis` / `router-role` | 위기·입장 판정(soft) | `ai.crisis.ts` 키워드, 라우터 2-a/2-d |

`hard pass` = status·retrieval·selection 통과, `soft pass` = crisis·role 까지 통과.
`retrieval@12` 는 라우터가 실제로 본 후보(로그 `retrievedIds`) 기준, `retrieval@20` 은 참고용 넓은 검색.

기본 게이트(`--gate`): retrieval ≥ 0.85, selection ≥ 0.75, status ≥ 0.9, forbidden = 0. `--min-recall= --min-selection= --min-status= --max-forbidden=` 로 조정.

## 케이스 추가 규칙

```json
{ "id": "labor-wage-01", "message": "사장님이 두 달째 알바비를 안 줘요",
  "tags": ["labor", "victim", "slang"],
  "expect": { "status": "relevant", "crisis": false, "userRole": "피해자",
              "manuals": ["사장님이 월급을 주지 않는데 어떻게 해야 하나요?"],
              "acceptable": ["임금은 언제, 어떻게 받아야 하나요?"],
              "forbidden": ["갑자기 알바에서 잘렸어요. 어떻게 해야 하나요?"] } }
```

- `manuals` 중 하나라도 선택되면 성공, `acceptable` 은 골라도 감점 없음, `forbidden` 은 고르면 실패(관점·유형 오류 감시용).
- `crisis`, `userRole` 은 명확할 때만 적는다(없으면 채점 제외).
- 제목이 DB와 한 글자라도 다르면 러너가 시작 시 전부 나열하며 실패한다. 같은 제목이 여러 카테고리에 있으면 `"slug::제목"`.
- 새 매뉴얼을 추가했으면 그 매뉴얼을 겨냥한 구어체 케이스 2~3개를 함께 넣는다.
- 실사용 문의(`AiChatHistory.question`)를 익명화해 보강하면 가장 값지다.

## 워크플로

1. 프롬프트/검색/임베딩을 바꾼다.
2. `npm run ai:eval` → 베이스라인 대비 ▲▼와 회귀/개선 케이스 목록을 본다.
3. 실패 케이스의 층을 보고 해당 부분만 손본다(위 표).
4. 만족하면 `npm run ai:eval -- --save-baseline` 으로 기준을 올리고 결과 파일을 커밋한다.

## 임베딩 운영 메모

- 임베딩은 `text-embedding-3-large`@1536(`ai.embeddings.ts`, `EMBED_VERSION`). 저장 해시가 `<버전>:<sha256>` 이라
  모델을 바꾸면 백필이 전 행을 재계산하고, 검색은 현재 버전 벡터만 사용한다(구버전은 렉시컬 폴백).
- `notion-migrate --apply` 가 적재 직후 임베딩까지 실행한다(`--skip-embed` 로 끔). 키가 없으면 미임베딩 건수와 복구 명령을 출력한다.
- 수동/복구/모델 교체: `npm run ai:embed`(드라이런) → `--apply --target=local` 또는 프로덕션은
  `railway run -s Postgres -- bash -lc 'DATABASE_URL="$DATABASE_PUBLIC_URL" npx ts-node prisma/backfill-embeddings.ts --apply --target=production --confirm-production=ilaw'`.
- 모델 교체 배포 순서: **코드 배포 → 즉시 프로덕션 백필**. 그 사이엔 시맨틱이 비어 렉시컬만 동작(안전한 열화). 백필을 먼저 하면 구버전 앱이 다른 모델 벡터를 비교해 결과가 망가진다.
