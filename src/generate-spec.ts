import fs from 'fs';
import path from 'path';
import swaggerSpec from './swagger';

const outPath = path.resolve(__dirname, '../docs/openapi.json');
fs.writeFileSync(outPath, JSON.stringify(swaggerSpec, null, 2));
console.log(`✓ ${outPath} generated`);
