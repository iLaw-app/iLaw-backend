import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { printScriptMode, resolveScriptMode } from './script-safety';

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
  '학교폭력': { slug: 'school-violence', order: 8, agencyCsv: '학교폭력.csv' },
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
  const mode = resolveScriptMode(process.argv.slice(2));
  printScriptMode(mode);
  console.log('Seeding manual categories, articles, and agencies...');

  const categoryFolders = fs.readdirSync(MANUAL_DIR)
    .filter(f => fs.statSync(path.join(MANUAL_DIR, f)).isDirectory())
    .map(f => f.normalize('NFC'));

  const unknownFolders = categoryFolders.filter((folderName) => !CATEGORY_CONFIG[folderName]);
  if (unknownFolders.length > 0) {
    throw new Error(`Unknown category folders: ${unknownFolders.join(', ')}`);
  }

  const plans = categoryFolders.map((folderName) => {
    const config = CATEGORY_CONFIG[folderName];
    const categoryDir = path.join(MANUAL_DIR, folderName);
    const articles = fs.readdirSync(categoryDir)
      .filter((file) => file.endsWith('.md'))
      .map((file, index) => ({ ...parseMarkdown(path.join(categoryDir, file)), order: index }));
    let agencies: Array<{ region: string; name: string; role: string; contact: string }> = [];
    if (config.agencyCsv) {
      const csvPath = path.join(AGENCIES_DIR, config.agencyCsv);
      if (fs.existsSync(csvPath)) agencies = parseCsv(csvPath);
    }
    return { folderName, config, articles, agencies };
  });
  const articleCount = plans.reduce((sum, plan) => sum + plan.articles.length, 0);
  const agencyCount = plans.reduce((sum, plan) => sum + plan.agencies.length, 0);
  console.log(`Validated ${categoryFolders.length} categories, ${articleCount} articles, ${agencyCount} agencies.`);
  if (!mode.apply) return;

  await prisma.$transaction(async (transaction) => {
    for (const plan of plans) {
      const category = await transaction.manualCategory.upsert({
        where: { slug: plan.config.slug },
        update: { name: plan.folderName, order: plan.config.order },
        create: { name: plan.folderName, slug: plan.config.slug, order: plan.config.order },
      });

      await transaction.manualArticle.deleteMany({ where: { categoryId: category.id } });
      await transaction.agency.deleteMany({ where: { categoryId: category.id } });
      await transaction.manualArticle.createMany({
        data: plan.articles.map((article) => ({ ...article, categoryId: category.id })),
      });
      if (plan.agencies.length > 0) {
        await transaction.agency.createMany({
          data: plan.agencies.map((agency) => ({ ...agency, categoryId: category.id })),
        });
      }
    }
  }, { timeout: 120_000 });

  for (const plan of plans) {
    console.log(`Category: ${plan.folderName}`);
    console.log(`  → ${plan.articles.length} articles`);
    console.log(`  → ${plan.agencies.length} agencies`);
  }

  console.log('Done!');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
