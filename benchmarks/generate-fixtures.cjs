const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
}

const TYPE_TEMPLATES = [
  // Interface
  (name, i) => `export interface ${name}${i} { id: string; name: string; value: number; }`,
  // Type alias
  (name, i) => `export type ${name}${i} = { id: string; data: string; } | null;`,
  // Class
  (name, i) => `export class ${name}${i} { constructor(public id: string) {} method() { return "${name}${i}"; } }`,
  // Function
  (name, i) => `export function ${name.toLowerCase()}${i}(input: string): string { return \`${name}${i}-\${input}\`; }`,
];

function generateFile(name, index, dir, imports = []) {
  const templateType = index % TYPE_TEMPLATES.length;
  const template = TYPE_TEMPLATES[templateType];
  let content = '';
  
  if (imports.length > 0) {
    content += imports.map(imp => `import { ${imp} } from "${imp}";`).join('\n') + '\n\n';
  }
  
  content += template(name, index);
  return content;
}

function generateFixture(name, fileCount, dirs) {
  const baseDir = `/Users/vedanshchandak/Desktop/devforge/benchmarks/fixtures/${name}/src`;
  
  // Create directories
  dirs.forEach(d => ensureDir(path.join(baseDir, d)));
  
  // Track generated symbols for imports
  const generatedSymbols = [];
  
  for (let i = 0; i < fileCount; i++) {
    const dir = dirs[i % dirs.length];
    const fileName = `${dir}-${String(i).padStart(5, '0')}.ts`;
    const filePath = path.join(baseDir, dir, fileName);
    
    // Generate imports from previous files (10% chance)
    const imports = [];
    if (i > 0 && Math.random() < 0.1) {
      const importCount = Math.min(3, generatedSymbols.length);
      for (let j = 0; j < importCount; j++) {
        const sym = generatedSymbols[Math.floor(Math.random() * generatedSymbols.length)];
        imports.push(sym);
      }
    }
    
    const symbolName = `${dir.charAt(0).toUpperCase() + dir.slice(1)}${String(i).padStart(5, '0')}`;
    generatedSymbols.push(symbolName);
    
    const content = generateFile(symbolName, i, dir, imports);
    writeFile(filePath, content);
  }
  
  // Create package.json
  writeFile(path.join(baseDir, '..', 'package.json'), JSON.stringify({
    name: `benchmark-${name}`,
    version: '1.0.0',
    private: true
  }, null, 2));
  
  // Create tsconfig.json
  writeFile(path.join(baseDir, '..', 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2020',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      declaration: true,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      outDir: './dist',
      rootDir: './src'
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist']
  }, null, 2));
  
  console.log(`Generated ${name} fixture with ${fileCount} files in ${dirs.length} directories`);
}

// Small: ~50 files
generateFixture('small', 50, ['models', 'services', 'utils', 'types', 'components']);

// Medium: ~500 files  
generateFixture('medium', 500, ['models', 'services', 'utils', 'types', 'components', 'controllers', 'repositories', 'middleware', 'validators', 'transformers']);

// Large: ~5000 files
generateFixture('large', 5000, ['models', 'services', 'utils', 'types', 'components', 'controllers', 'repositories', 'middleware', 'validators', 'transformers', 'handlers', 'pipes', 'guards', 'interceptors', 'decorators', 'modules', 'providers', 'injectables', 'entities', 'dtos']);

console.log('All fixtures generated!');
