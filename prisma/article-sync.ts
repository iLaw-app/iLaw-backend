// 매뉴얼 재적재 계획 수립.
//
// ManualArticle을 전부 지우고 다시 만들면 id가 매번 바뀐다. ArticleScrap이
// onDelete: Cascade이므로 사용자 스크랩이 통째로 사라지고, 임베딩도 전부
// 재생성해야 한다. 그래서 "카테고리 + question"이 같은 행은 id를 유지한 채
// 내용만 갱신하고, 입력에서 사라진 행만 삭제한다.

export type ExistingArticle = { id: number; categoryId: number; question: string };
export type IncomingArticle<T> = T & { categoryId: number; question: string };

export type ArticleSyncPlan<T> = {
  toCreate: Array<IncomingArticle<T>>;
  toUpdate: Array<{ id: number; article: IncomingArticle<T> }>;
  toDeleteIds: number[];
};

function key(categoryId: number, question: string) {
  return `${categoryId} ${question}`;
}

export function planArticleSync<T>(
  existing: ExistingArticle[],
  incoming: Array<IncomingArticle<T>>,
): ArticleSyncPlan<T> {
  const existingByKey = new Map(existing.map((row) => [key(row.categoryId, row.question), row.id]));

  const plan: ArticleSyncPlan<T> = { toCreate: [], toUpdate: [], toDeleteIds: [] };
  const seen = new Set<number>();

  for (const article of incoming) {
    const id = existingByKey.get(key(article.categoryId, article.question));
    if (id === undefined) {
      plan.toCreate.push(article);
      continue;
    }
    plan.toUpdate.push({ id, article });
    seen.add(id);
  }

  plan.toDeleteIds = existing.filter((row) => !seen.has(row.id)).map((row) => row.id);
  return plan;
}
