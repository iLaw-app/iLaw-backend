import { describe, expect, it } from 'vitest';
import { planArticleSync } from '../prisma/article-sync';

const EXISTING = [
  { id: 10, categoryId: 1, question: '질문 A' },
  { id: 11, categoryId: 1, question: '질문 B' },
  { id: 12, categoryId: 2, question: '질문 A' },
];

function incoming(categoryId: number, question: string, content = '본문') {
  return { categoryId, question, content };
}

describe('매뉴얼 재적재 계획', () => {
  it('같은 카테고리+제목이면 id를 유지한 채 갱신한다', () => {
    const plan = planArticleSync(EXISTING, [incoming(1, '질문 A', '수정된 본문')]);

    expect(plan.toCreate).toEqual([]);
    expect(plan.toUpdate).toEqual([
      { id: 10, article: { categoryId: 1, question: '질문 A', content: '수정된 본문' } },
    ]);
  });

  it('카테고리가 다르면 제목이 같아도 다른 글로 본다', () => {
    const plan = planArticleSync(EXISTING, [incoming(1, '질문 A'), incoming(2, '질문 A')]);

    expect(plan.toUpdate.map((entry) => entry.id).sort()).toEqual([10, 12]);
    expect(plan.toCreate).toEqual([]);
  });

  it('기존에 없던 글만 새로 만든다', () => {
    const plan = planArticleSync(EXISTING, [incoming(1, '질문 A'), incoming(1, '새 질문')]);

    expect(plan.toCreate).toEqual([{ categoryId: 1, question: '새 질문', content: '본문' }]);
  });

  it('입력에서 사라진 글만 삭제 대상이다', () => {
    const plan = planArticleSync(EXISTING, [incoming(1, '질문 A')]);

    expect(plan.toDeleteIds.sort()).toEqual([11, 12]);
  });

  // 전량 재적재는 예전 동작(delete+create)과 결과가 같아 보이지만, 삭제가 없어야
  // ArticleScrap이 cascade로 지워지지 않는다. 이 테스트가 그 불변식을 지킨다.
  it('입력이 기존과 같으면 아무것도 만들거나 지우지 않는다', () => {
    const plan = planArticleSync(EXISTING, [
      incoming(1, '질문 A'),
      incoming(1, '질문 B'),
      incoming(2, '질문 A'),
    ]);

    expect(plan.toCreate).toEqual([]);
    expect(plan.toDeleteIds).toEqual([]);
    expect(plan.toUpdate).toHaveLength(3);
  });

  it('기존 글이 없으면 전부 생성한다', () => {
    const plan = planArticleSync([], [incoming(1, '질문 A')]);

    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toDeleteIds).toEqual([]);
  });
});
