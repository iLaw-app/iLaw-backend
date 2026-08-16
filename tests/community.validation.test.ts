import { describe, expect, it } from 'vitest';
import {
  validateCommentInput,
  validateCreatePostInput,
  validateSearchQuery,
  validateUpdatePostInput,
  validateVoteInput,
} from '../src/services/community-validation';

describe('커뮤니티 입력 검증', () => {
  it('기존 정상 게시글 생성 입력은 그대로 허용한다', () => {
    expect(validateCreatePostInput({
      title: '정상 제목',
      content: '정상 본문',
      imageUrls: ['https://cdn.test/a.png'],
      poll: { options: [{ label: '찬성', votes: 3 }, { label: '반대' }] },
    })).toEqual({
      data: {
        title: '정상 제목',
        content: '정상 본문',
        imageUrls: ['https://cdn.test/a.png'],
        poll: { options: [{ label: '찬성' }, { label: '반대' }] },
      },
    });
  });

  it.each([
    [{ title: 123 }, 'invalid_title'],
    [{ title: 'x'.repeat(201) }, 'invalid_title'],
    [{ title: '제목', content: 123 }, 'invalid_content'],
    [{ title: '제목', content: 'x'.repeat(10_001) }, 'invalid_content'],
    [{ title: '제목', imageUrls: 'https://cdn.test/a.png' }, 'invalid_image_urls'],
    [{ title: '제목', imageUrls: Array.from({ length: 11 }, (_, i) => `https://cdn.test/${i}.png`) }, 'invalid_image_urls'],
    [{ title: '제목', imageUrls: [123] }, 'invalid_image_urls'],
    [{ title: '제목', poll: { options: [{ label: '하나' }, { label: 2 }] } }, 'invalid_poll'],
    [{ title: '제목', poll: { options: Array.from({ length: 21 }, (_, i) => ({ label: String(i) })) } }, 'invalid_poll'],
    [{ title: '제목', poll: { options: [{ label: 'x'.repeat(101) }, { label: '둘' }] } }, 'invalid_poll'],
  ] as const)('잘못된 생성 입력 %#을 거부한다', (input, error) => {
    expect(validateCreatePostInput(input)).toEqual({ error });
  });

  it('수정 입력도 제목·본문·투표·이미지 타입과 상한을 동일하게 검증한다', () => {
    expect(validateUpdatePostInput({ title: [] })).toEqual({ error: 'invalid_title' });
    expect(validateUpdatePostInput({ content: 'x'.repeat(10_001) })).toEqual({ error: 'invalid_content' });
    expect(validateUpdatePostInput({ imageUrls: Array(11).fill('https://cdn.test/a') })).toEqual({ error: 'invalid_image_urls' });
    expect(validateUpdatePostInput({ poll: { options: [] } })).toEqual({ error: 'invalid_poll' });
  });

  it('댓글은 문자열만 허용하고 빈 값과 2000자 초과를 거부한다', () => {
    expect(validateCommentInput({ content: 1 })).toEqual({ error: 'invalid_comment' });
    expect(validateCommentInput({ content: '   ' })).toEqual({ error: 'invalid_comment' });
    expect(validateCommentInput({ content: 'x'.repeat(2_001) })).toEqual({ error: 'invalid_comment' });
    expect(validateCommentInput({ content: '정상 댓글', parentId: 3 })).toEqual({ data: { content: '정상 댓글', parentId: 3 } });
  });

  it('투표 인덱스는 정수 number 타입만 허용한다', () => {
    expect(validateVoteInput({ optionIndex: '0' })).toEqual({ error: 'invalid_option' });
    expect(validateVoteInput({ optionIndex: 0 })).toEqual({ data: { optionIndex: 0 } });
  });

  it('검색어는 문자열 200자 이하만 허용하고 빈 문자열은 기존처럼 빈 결과로 처리한다', () => {
    expect(validateSearchQuery(['검색어'])).toEqual({ error: 'invalid_query' });
    expect(validateSearchQuery('x'.repeat(201))).toEqual({ error: 'invalid_query' });
    expect(validateSearchQuery('   ')).toEqual({ data: { query: '' } });
    expect(validateSearchQuery('  정상 검색  ')).toEqual({ data: { query: '정상 검색' } });
  });
});
