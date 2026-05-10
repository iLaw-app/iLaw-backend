import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

const DATA_DIR = path.join(__dirname, 'data');
const MANUAL_DIR = path.join(DATA_DIR, 'manual');
const AGENCIES_DIR = path.join(DATA_DIR, 'agencies');

const CATEGORY_CONFIG: Record<string, { slug: string; order: number; agencyCsv?: string }> = {
  '금융(빚 사기 도박)': { slug: 'finance', order: 1, agencyCsv: '금융.csv' },
  '노동': { slug: 'labor', order: 2, agencyCsv: '노동.csv' },
  '성폭력 데이트폭력 성착취': { slug: 'sexual-violence', order: 3, agencyCsv: '성폭력.csv' },
  '아동학대': { slug: 'child-abuse', order: 4, agencyCsv: '아동학대.csv' },
  '온라인폭력': { slug: 'online-violence', order: 5, agencyCsv: '온라인폭력.csv' },
  '출생과 양육': { slug: 'birth-and-parenting', order: 6, agencyCsv: '출생과양육.csv' },
  '친권 미성년후견': { slug: 'parental-rights', order: 7, agencyCsv: '친권미성년후견.csv' },
};

function parseMarkdown(filePath: string): { question: string; summary: string | null; content: string } {
  const text = fs.readFileSync(filePath, 'utf-8');
  const lines = text.split('\n');

  let question = '';
  let summary: string | null = null;
  let h1Count = 0;
  const contentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('# ') && h1Count < 2) {
      h1Count++;
      if (h1Count === 1) question = line.slice(2).trim();
      else summary = line.slice(2).trim();
    } else if (h1Count >= 2) {
      contentLines.push(line);
    }
  }

  return { question, summary, content: contentLines.join('\n').trim() };
}

function parseCsv(filePath: string): Array<{ region: string; name: string; role: string; contact: string }> {
  const text = fs.readFileSync(filePath, 'utf-8');
  const lines = text.split('\n').slice(1); // skip header

  return lines
    .map(line => line.split(','))
    .filter(cols => cols.length >= 4 && cols[0].trim() && cols[1].trim())
    .map(cols => ({
      region: cols[0].trim(),
      name: cols[1].trim(),
      role: cols[2].trim(),
      contact: cols[3].trim(),
    }));
}

async function main() {
  console.log('Seeding manual categories, articles, and agencies...');

  const categoryFolders = fs.readdirSync(MANUAL_DIR)
    .filter(f => fs.statSync(path.join(MANUAL_DIR, f)).isDirectory())
    .map(f => f.normalize('NFC'));

  for (const folderName of categoryFolders) {
    const config = CATEGORY_CONFIG[folderName];
    if (!config) {
      console.warn(`Unknown category folder: ${folderName}, skipping`);
      continue;
    }

    const category = await prisma.manualCategory.upsert({
      where: { slug: config.slug },
      update: { name: folderName, order: config.order },
      create: { name: folderName, slug: config.slug, order: config.order },
    });

    console.log(`Category: ${folderName}`);

    // Delete existing articles and agencies for this category before re-seeding
    await prisma.manualArticle.deleteMany({ where: { categoryId: category.id } });
    await prisma.agency.deleteMany({ where: { categoryId: category.id } });

    // Seed articles
    const categoryDir = path.join(MANUAL_DIR, folderName);
    const mdFiles = fs.readdirSync(categoryDir).filter(f => f.endsWith('.md'));

    const articles = mdFiles.map((file, index) => {
      const { question, summary, content } = parseMarkdown(path.join(categoryDir, file));
      return { categoryId: category.id, question, summary, content, order: index };
    });

    await prisma.manualArticle.createMany({ data: articles });
    console.log(`  → ${articles.length} articles`);

    // Seed agencies
    if (config.agencyCsv) {
      const csvPath = path.join(AGENCIES_DIR, config.agencyCsv);
      if (fs.existsSync(csvPath)) {
        const agencies = parseCsv(csvPath).map(a => ({ ...a, categoryId: category.id }));
        await prisma.agency.createMany({ data: agencies });
        console.log(`  → ${agencies.length} agencies`);
      }
    }
  }

  console.log('Done!');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
