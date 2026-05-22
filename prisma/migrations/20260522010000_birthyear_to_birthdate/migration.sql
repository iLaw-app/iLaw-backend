-- birthYear(Int) → birthDate(DateTime) 변환
-- 기존 연도 데이터는 해당 연도 1월 1일로 변환
ALTER TABLE "User" RENAME COLUMN "birthYear" TO "birthDate";
ALTER TABLE "User" ALTER COLUMN "birthDate" TYPE TIMESTAMP(3)
  USING CASE WHEN "birthDate" IS NOT NULL
    THEN MAKE_TIMESTAMP("birthDate"::int, 1, 1, 0, 0, 0)
    ELSE NULL
  END;
