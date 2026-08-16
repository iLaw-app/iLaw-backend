import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { printScriptMode, resolveScriptMode } from './script-safety';
import { planArticleSync } from './article-sync';
import { buildPublicObjectUrl } from '../src/utils/storage-url';

const prisma = new PrismaClient();

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.AWS_S3_BUCKET!;
const EXPORT_DIR = path.join(__dirname, 'data/notion-export/DB');

// 키 = Notion "카테고리" 속성값. displayName을 지정하면 DB에 저장되는 이름은 그쪽을 따른다
// (Notion 쪽 명칭을 바꾸지 않고 서비스 노출명만 다르게 가져갈 때 사용).
const CATEGORY_CONFIG: Record<string, { slug: string; order: number; displayName?: string }> = {
  '금융':             { slug: 'finance',            order: 1 },
  '노동':             { slug: 'labor',               order: 2 },
  '성폭력':           { slug: 'sexual-violence',     order: 3 },
  '아동학대/가정폭력': { slug: 'child-abuse',         order: 4 },
  '온라인폭력':       { slug: 'online-violence',     order: 5 },
  '출생/양육':        { slug: 'birth-and-parenting', order: 6 },
  '법정대리인':       { slug: 'parental-rights',     order: 7 },
  '학교폭력':         { slug: 'school-violence',     order: 8 },
  '생활 지원':        { slug: 'out-of-school-youth', order: 9, displayName: '학교 밖 청소년' },
};

async function uploadToS3(filePath: string, s3Key: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  const contentTypeMap: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.gif': 'image/gif',
  };
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
    Body: fs.readFileSync(filePath),
    ContentType: contentTypeMap[ext] ?? 'image/png',
  }));
  return buildPublicObjectUrl(s3Key);
}

async function parseHtmlFile(htmlFile: string, uploadImages = true) {
  const html = fs.readFileSync(htmlFile, 'utf-8');
  const $ = cheerio.load(html);

  const question = $('h1.page-title').text().trim();

  let order = 0;
  let categoryName = '';
  $('tr.property-row').each((_, row) => {
    const label = $(row).find('th').text().trim();
    const value = $(row).find('td').text().trim();
    if (label === 'order') order = parseInt(value) || 0;
    if (label === '카테고리') categoryName = value.trim();
  });

  const pageBody = $('.page-body');

  // First blockquote = summary
  const firstBlockquote = pageBody.find('blockquote').first();
  let summary: string | null = null;
  if (firstBlockquote.length) {
    summary = firstBlockquote.text().replace(/\s+/g, ' ').trim();
    // Remove the wrapper div containing the blockquote
    const wrapper = firstBlockquote.parent();
    (wrapper.is('div') ? wrapper : firstBlockquote).remove();
  }

  // Upload local images to S3 and replace src URLs
  // HTML 파일명은 "제목 {UUID}.html" 형태, 이미지 폴더는 "제목" (UUID 없음)
  const htmlFileName = path.basename(htmlFile, '.html');
  const folderNameWithoutUuid = htmlFileName.replace(/\s+[0-9a-f]{32}$/i, '');
  const imageFolder = path.join(EXPORT_DIR, folderNameWithoutUuid);

  if (uploadImages && fs.existsSync(imageFolder)) {
    const imageFiles = fs.readdirSync(imageFolder).filter(f => /\.(png|jpe?g|webp|gif)$/i.test(f));
    for (const imageFile of imageFiles) {
      const s3Key = `manual-images/${htmlFileName}/${imageFile}`;
      const s3Url = await uploadToS3(path.join(imageFolder, imageFile), s3Key);

      pageBody.find('img').each((_, img) => {
        const src = decodeURIComponent($(img).attr('src') ?? '');
        if (src.endsWith(imageFile)) $(img).attr('src', s3Url);
      });
    }
  }

  // Unwrap <a> tags wrapping figures (Notion adds these)
  pageBody.find('figure a').each((_, a) => { $(a).replaceWith($(a).html() ?? ''); });

  // Remove Notion icon images
  pageBody.find('img[src*="notion.so"]').closest('span').remove();

  // Remove id/dir attributes
  pageBody.find('[id]').removeAttr('id');
  pageBody.find('[dir]').removeAttr('dir');

  // Unwrap display:contents divs (Notion's wrapper pattern)
  let changed = true;
  while (changed) {
    changed = false;
    pageBody.find('div[style="display:contents"]').each((_, div) => {
      $(div).replaceWith($(div).html() ?? '');
      changed = true;
    });
  }

  // Remove empty paragraphs
  pageBody.find('p').each((_, p) => {
    if (!$(p).text().trim()) $(p).remove();
  });

  const content = pageBody.html()?.trim() ?? '';

  return { question, summary, content, order, categoryName };
}

async function main() {
  const mode = resolveScriptMode(process.argv.slice(2));
  printScriptMode(mode);

  const htmlFiles = fs.readdirSync(EXPORT_DIR)
    .filter(f => f.endsWith('.html'))
    .map(f => path.join(EXPORT_DIR, f));

  console.log(`Found ${htmlFiles.length} HTML files\n`);

  const invalidFiles: string[] = [];
  // 재적재는 "카테고리 + question"으로 기존 행을 찾으므로 이 조합이 중복되면
  // 한쪽이 매번 삭제/재생성되어 스크랩과 임베딩을 잃는다. 입력 단계에서 막는다.
  const seenKeys = new Map<string, string>();
  const duplicateKeys: string[] = [];
  for (const htmlFile of htmlFiles) {
    try {
      const parsed = await parseHtmlFile(htmlFile, false);
      if (!parsed.question || !CATEGORY_CONFIG[parsed.categoryName]) {
        invalidFiles.push(path.basename(htmlFile));
        continue;
      }
      const key = `${parsed.categoryName} ${parsed.question}`;
      const previous = seenKeys.get(key);
      if (previous) {
        duplicateKeys.push(`"${parsed.question}" (${parsed.categoryName}): ${previous} / ${path.basename(htmlFile)}`);
      } else {
        seenKeys.set(key, path.basename(htmlFile));
      }
    } catch {
      invalidFiles.push(path.basename(htmlFile));
    }
  }
  if (invalidFiles.length > 0) {
    throw new Error(`Input validation failed: ${invalidFiles.join(', ')}`);
  }
  if (duplicateKeys.length > 0) {
    throw new Error(`같은 카테고리에 제목이 중복됩니다:\n  ${duplicateKeys.join('\n  ')}`);
  }
  console.log(`Validated ${htmlFiles.length} input files.`);
  if (!mode.apply) return;

  const parsedArticles: Array<{
    question: string;
    summary: string | null;
    content: string;
    order: number;
    categoryName: string;
  }> = [];
  for (const htmlFile of htmlFiles) {
    const parsed = await parseHtmlFile(htmlFile);
    if (!CATEGORY_CONFIG[parsed.categoryName]) {
      throw new Error(`Unknown category in ${path.basename(htmlFile)}: ${parsed.categoryName}`);
    }
    parsedArticles.push(parsed);
  }

  const categoryRows = await prisma.$transaction(async (transaction) => {
    const categoryMap: Record<string, number> = {};
    const rows: Array<{ id: number; name: string }> = [];
    for (const [notionName, cfg] of Object.entries(CATEGORY_CONFIG)) {
      const name = cfg.displayName ?? notionName;
      const category = await transaction.manualCategory.upsert({
        where: { slug: cfg.slug },
        update: { name, order: cfg.order },
        create: { name, slug: cfg.slug, order: cfg.order },
      });
      categoryMap[notionName] = category.id;
      rows.push({ id: category.id, name });
    }

    // 재적재는 delete+create가 아니라 "같은 카테고리 + 같은 question"을 기준으로 맞춘다.
    // 전부 지우고 다시 만들면 ManualArticle.id가 매번 바뀌는데, ArticleScrap이
    // onDelete: Cascade라 사용자 스크랩이 통째로 사라지고 임베딩도 전부 재생성된다.
    const existing = await transaction.manualArticle.findMany({
      where: { categoryId: { in: Object.values(categoryMap) } },
      select: { id: true, categoryId: true, question: true },
    });
    const plan = planArticleSync(
      existing,
      parsedArticles.map(({ categoryName, ...article }) => ({
        ...article,
        categoryId: categoryMap[categoryName],
      })),
    );

    for (const article of plan.toCreate) {
      await transaction.manualArticle.create({ data: article });
    }
    for (const { id, article } of plan.toUpdate) {
      await transaction.manualArticle.update({
        where: { id },
        data: { summary: article.summary, content: article.content, order: article.order },
      });
    }
    if (plan.toDeleteIds.length > 0) {
      await transaction.manualArticle.deleteMany({ where: { id: { in: plan.toDeleteIds } } });
    }

    return {
      rows,
      created: plan.toCreate.length,
      updated: plan.toUpdate.length,
      removed: plan.toDeleteIds.length,
    };
  }, { timeout: 120_000 });

  for (const category of categoryRows.rows) console.log(`Category: ${category.name} (id=${category.id})`);
  console.log(`Done: ${parsedArticles.length} articles — 신규 ${categoryRows.created}, 갱신 ${categoryRows.updated}, 삭제 ${categoryRows.removed}`);
  if (categoryRows.removed > 0) {
    console.log(`  주의: 삭제된 ${categoryRows.removed}건에 달린 사용자 스크랩도 함께 제거되었습니다.`);
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
