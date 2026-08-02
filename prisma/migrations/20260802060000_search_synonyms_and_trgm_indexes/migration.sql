-- Search overhaul: trigram indexes for LIKE '%term%' + data-driven synonym groups.
--
-- pg_trgm is a bundled contrib extension (available on Railway's Postgres image);
-- pg_bigm would suit Korean better but is not bundled. The GIN trgm indexes
-- accelerate the keyword search's LIKE '%term%' probes for terms >= 3 chars.

-- Extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateTable
CREATE TABLE "SearchSynonym" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "term" TEXT NOT NULL,

    CONSTRAINT "SearchSynonym_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SearchSynonym_groupId_term_key" ON "SearchSynonym"("groupId", "term");

-- CreateIndex
CREATE INDEX "SearchSynonym_groupId_idx" ON "SearchSynonym"("groupId");

-- Seed synonym groups (source of truth: former src/services/synonyms.ts).
-- 24 groups, 118 terms.
INSERT INTO "SearchSynonym" ("groupId", "term") VALUES
  (1, '알바'),
  (1, '아르바이트'),
  (1, '알바비'),
  (1, '파트타임'),
  (1, '시급'),
  (1, '단기알바'),
  (2, '임금'),
  (2, '급여'),
  (2, '월급'),
  (2, '알바비'),
  (2, '봉급'),
  (2, '연봉'),
  (3, '임금체불'),
  (3, '미지급'),
  (3, '못 받음'),
  (3, '안 줌'),
  (3, '체불'),
  (3, '급여 안 줌'),
  (4, '해고'),
  (4, '권고사직'),
  (4, '강제퇴직'),
  (4, '해임'),
  (4, '면직'),
  (4, '퇴사'),
  (4, '짤림'),
  (5, '근로계약'),
  (5, '계약서'),
  (5, '고용계약'),
  (6, '노동'),
  (6, '근로'),
  (6, '직장'),
  (6, '일자리'),
  (6, '취업'),
  (7, '산재'),
  (7, '산업재해'),
  (7, '업무상재해'),
  (7, '직업병'),
  (7, '업무 중 부상'),
  (8, '성폭력'),
  (8, '성추행'),
  (8, '성희롱'),
  (8, '강간'),
  (8, '성적폭행'),
  (8, '성범죄'),
  (9, '직장내성희롱'),
  (9, '성희롱'),
  (9, '직장 성폭력'),
  (10, '데이트폭력'),
  (10, '교제폭력'),
  (10, '연인폭력'),
  (10, '연애폭력'),
  (11, '스토킹'),
  (11, '스토커'),
  (11, '따라다님'),
  (11, '집착'),
  (12, '아동학대'),
  (12, '아이학대'),
  (12, '어린이학대'),
  (12, '청소년학대'),
  (12, '학대'),
  (13, '방임'),
  (13, '방치'),
  (13, '돌봄 방기'),
  (14, '사이버폭력'),
  (14, '온라인폭력'),
  (14, '인터넷폭력'),
  (14, '디지털폭력'),
  (14, '사이버불링'),
  (14, '싸불'),
  (14, '온라인 괴롭힘'),
  (15, '명예훼손'),
  (15, '비방'),
  (15, '허위사실 유포'),
  (15, '악플'),
  (15, '모욕'),
  (16, '개인정보유출'),
  (16, '신상털기'),
  (16, '신상유출'),
  (16, '정보유출'),
  (16, '개인정보 침해'),
  (17, '사기'),
  (17, '피싱'),
  (17, '보이스피싱'),
  (17, '금융사기'),
  (17, '다단계'),
  (17, '스캠'),
  (18, '빚'),
  (18, '대출'),
  (18, '부채'),
  (18, '채무'),
  (18, '채권'),
  (19, '도박'),
  (19, '불법도박'),
  (19, '온라인도박'),
  (19, '도박중독'),
  (19, '베팅'),
  (19, '불법베팅'),
  (20, '양육권'),
  (20, '친권'),
  (20, '면접교섭권'),
  (20, '자녀양육'),
  (21, '양육비'),
  (21, '아동양육비'),
  (21, '미지급양육비'),
  (22, '이혼'),
  (22, '별거'),
  (22, '협의이혼'),
  (22, '재판이혼'),
  (22, '파경'),
  (23, '출산'),
  (23, '임신'),
  (23, '출산휴가'),
  (23, '산전후휴가'),
  (24, '육아'),
  (24, '양육'),
  (24, '아이 돌봄'),
  (24, '보육'),
  (24, '육아휴직');

-- Trigram GIN indexes on searchable text columns.
CREATE INDEX "ManualArticle_question_idx" ON "ManualArticle" USING GIN ("question" gin_trgm_ops);
CREATE INDEX "ManualArticle_summary_idx" ON "ManualArticle" USING GIN ("summary" gin_trgm_ops);
CREATE INDEX "ManualArticle_content_idx" ON "ManualArticle" USING GIN ("content" gin_trgm_ops);
CREATE INDEX "QnAPost_title_idx" ON "QnAPost" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "QnAPost_content_idx" ON "QnAPost" USING GIN ("content" gin_trgm_ops);
CREATE INDEX "QnAAnswer_content_idx" ON "QnAAnswer" USING GIN ("content" gin_trgm_ops);
CREATE INDEX "CommunityPost_title_idx" ON "CommunityPost" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "CommunityPost_content_idx" ON "CommunityPost" USING GIN ("content" gin_trgm_ops);
