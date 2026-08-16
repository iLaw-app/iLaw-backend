import { describe, expect, it } from 'vitest';
import {
  parsePagination,
  parsePositiveInteger,
  validateManualSearch,
  validateNotificationListQuery,
  validateQAAnswer,
  validateQAPost,
} from '../src/utils/validation';
import { buildPublicObjectUrl } from '../src/utils/storage-url';

describe('공통 API 입력 검증', () => {
  it('숫자 params는 안전한 양의 정수 문자열만 허용한다', () => {
    expect(parsePositiveInteger('1')).toBe(1);
    expect(parsePositiveInteger('01')).toBeNull();
    expect(parsePositiveInteger('1e2')).toBeNull();
    expect(parsePositiveInteger('9007199254740992')).toBeNull();
    expect(parsePositiveInteger('-1')).toBeNull();
  });

  it('pagination 기본값과 최대값을 적용하고 잘못된 타입은 거부한다', () => {
    expect(parsePagination({})).toEqual({ data: { page: 1, limit: 20 } });
    expect(parsePagination({ page: '2', limit: '100' })).toEqual({ data: { page: 2, limit: 100 } });
    expect(parsePagination({ limit: '101' })).toEqual({ error: 'invalid_pagination' });
    expect(parsePagination({ limit: ['20'] })).toEqual({ error: 'invalid_pagination' });
    expect(parsePagination({ page: String(Number.MAX_SAFE_INTEGER), limit: '100' })).toEqual({ error: 'invalid_pagination' });
  });

  it('Q&A 정상 payload를 trim하고 이미지 URL을 허용한다', () => {
    const result = validateQAPost({
      title: '  제목  ',
      content: '  본문  ',
      category: ' labor ',
      imageUrls: [' https://cdn.example.com/uploads/a.jpg '],
    }, { AWS_CDN_BASE_URL: 'https://cdn.example.com' });

    expect(result).toEqual({ data: {
      title: '제목', content: '본문', category: 'labor',
      imageUrls: ['https://cdn.example.com/uploads/a.jpg'],
    } });
  });

  it('업로드가 생성하는 운영 CDN 경로와 S3 fallback URL을 allowlist가 허용한다', () => {
    const cdnEnv = {
      AWS_CDN_BASE_URL: 'https://d111111abcdef8.cloudfront.net/media/',
      AWS_S3_BUCKET: 'ilaw-production-assets',
      AWS_REGION: 'ap-northeast-2',
    };
    const s3Env = {
      AWS_S3_BUCKET: 'ilaw-production-assets',
      AWS_REGION: 'ap-northeast-2',
    };
    const input = (imageUrl: string) => ({
      title: '제목', content: '본문', category: 'labor', imageUrls: [imageUrl],
    });

    const cdnUrl = buildPublicObjectUrl('uploads/a.jpg', cdnEnv);
    const s3Url = buildPublicObjectUrl('uploads/a.jpg', s3Env);
    expect(cdnUrl).toBe('https://d111111abcdef8.cloudfront.net/media/uploads/a.jpg');
    expect(s3Url).toBe('https://ilaw-production-assets.s3.ap-northeast-2.amazonaws.com/uploads/a.jpg');
    expect(validateQAPost(input(cdnUrl), cdnEnv)).toMatchObject({ data: { imageUrls: [cdnUrl] } });
    expect(validateQAPost(input(s3Url), s3Env)).toMatchObject({ data: { imageUrls: [s3Url] } });
  });

  it('Q&A 필드 타입·길이·이미지 배열 상한과 URL allowlist/https를 검증한다', () => {
    const env = { AWS_CDN_BASE_URL: 'https://cdn.example.com' };
    expect(validateQAPost({ title: 1, content: '본문', category: 'labor' }, env)).toEqual({ error: 'invalid_qa_post' });
    expect(validateQAPost({ title: 'x'.repeat(201), content: '본문', category: 'labor' }, env)).toEqual({ error: 'invalid_qa_post' });
    expect(validateQAPost({ title: '제목', content: 'x'.repeat(10_001), category: 'labor' }, env)).toEqual({ error: 'invalid_qa_post' });
    expect(validateQAPost({ title: '제목', content: '본문', category: 'labor', imageUrls: Array(11).fill('https://cdn.example.com/a') }, env)).toEqual({ error: 'invalid_image_urls' });
    expect(validateQAPost({ title: '제목', content: '본문', category: 'labor', imageUrls: ['http://cdn.example.com/a'] }, env)).toEqual({ error: 'invalid_image_urls' });
    expect(validateQAPost({ title: '제목', content: '본문', category: 'labor', imageUrls: ['https://evil.example/a'] }, env)).toEqual({ error: 'invalid_image_urls' });
  });

  it('답변은 문자열만 허용하고 trim·길이 상한을 적용한다', () => {
    expect(validateQAAnswer({ content: '  답변  ' })).toEqual({ data: { content: '답변' } });
    expect(validateQAAnswer({ content: {} })).toEqual({ error: 'invalid_answer' });
    expect(validateQAAnswer({ content: 'x'.repeat(10_001) })).toEqual({ error: 'invalid_answer' });
  });

  it('manual 검색어를 trim하고 타입·길이를 검증한다', () => {
    expect(validateManualSearch({ q: '  임금 체불  ', categorySlug: ' labor ', debug: 'true' }))
      .toEqual({ data: { query: '임금 체불', categorySlug: 'labor', debug: true } });
    expect(validateManualSearch({ q: ['검색어'] })).toEqual({ error: 'invalid_query' });
    expect(validateManualSearch({ q: 'x'.repeat(201) })).toEqual({ error: 'invalid_query' });
    expect(validateManualSearch({ q: '검색', debug: 'yes' })).toEqual({ error: 'invalid_query' });
  });

  it('notification 목록 query는 pagination 외 값을 허용하지 않는다', () => {
    expect(validateNotificationListQuery({ limit: '30', page: '2' }))
      .toEqual({ data: { limit: 30, page: 2 } });
    expect(validateNotificationListQuery({ limit: 'NaN' })).toEqual({ error: 'invalid_pagination' });
    expect(validateNotificationListQuery({ cursor: '1' })).toEqual({ error: 'invalid_pagination' });
  });
});
