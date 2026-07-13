const fs = require('fs');
const path = require('path');

const dirs = ['modules', 'services', 'utils', 'models', 'components'];
const baseDir = '/Users/vedanshchandak/Desktop/devforge/packages/integration-tests/fixtures/large-fixture/src';

// Create directories
dirs.forEach(dir => {
  fs.mkdirSync(path.join(baseDir, dir), { recursive: true });
});

// Generate ~100 files
const fileCount = 100;
for (let i = 0; i < fileCount; i++) {
  const dir = dirs[i % dirs.length];
  const fileName = `${dir}-${String(i).padStart(3, '0')}.ts`;
  const filePath = path.join(baseDir, dir, fileName);
  
  const types = [
    `export interface ${dir.charAt(0).toUpperCase() + dir.slice(1)}Item${i} { id: string; name: string; value: number; }`,
    `export type ${dir.charAt(0).toUpperCase() + dir.slice(1)}Type${i} = "a" | "b" | "c";`,
    `export class ${dir.charAt(0).toUpperCase() + dir.slice(1)}Class${i} { constructor(public id: string) {} method() { return "${dir}-${i}"; } }`,
    `export function ${dir}Function${i}(input: string): string { return \`${dir}-${i}-\${input}\`; }`,
  ];
  
  const typeIndex = i % types.length;
  let content = types[typeIndex] + '\n';
  
  if (i > 0) {
    const importFrom = dirs[(i - 1) % dirs.length];
    const importFile = `${importFrom}-${String(i - 1).padStart(3, '0')}`;
    content += `import { ${importFrom.charAt(0).toUpperCase() + importFrom.slice(1)}Class${i - 1} } from "../${importFrom}/${importFile}.js";\n`;
  }
  
  fs.writeFileSync(filePath, content);
}

console.log(`Generated ${fileCount} files in ${baseDir}`);
