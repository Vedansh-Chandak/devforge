import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile, readFile, mkdir } from "node:fs/promises";

import { 
  runBenchmark, 
  formatResult, 
  runMultipleBenchmarks, 
  calculateMedian,
  BenchmarkResult 
} from "./runner.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
// Go from packages/benchmark/src -> packages/benchmark -> packages -> devforge -> benchmarks/fixtures
const ROOT_DIR = resolve(__dirname, "../../..");
const FIXTURES_DIR = resolve(ROOT_DIR, "benchmarks/fixtures");
const RESULTS_DIR = resolve(ROOT_DIR, "benchmarks/results");
const BASELINES_DIR = resolve(ROOT_DIR, "benchmarks/baselines");

const FIXTURES = {
  small: "small",
  medium: "medium",
  large: "large",
} as const;

type FixtureSize = keyof typeof FIXTURES;

interface CliOptions {
  size?: FixtureSize;
  all?: boolean;
  baseline?: boolean;
  compare?: boolean;
  output?: string;
  json?: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--size" || arg === "-s") {
      options.size = args[++i] as FixtureSize;
    } else if (arg === "--all" || arg === "-a") {
      options.all = true;
    } else if (arg === "--baseline" || arg === "-b") {
      options.baseline = true;
    } else if (arg === "--compare" || arg === "-c") {
      options.compare = true;
    } else if (arg === "--output" || arg === "-o") {
      options.output = args[++i];
    } else if (arg === "--json" || arg === "-j") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  
  return options;
}

function printHelp() {
  console.log(`
DevForge Benchmark Suite

Usage: devforge-benchmark [options]

Options:
  -s, --size <size>     Benchmark size: small, medium, large (default: small)
  -a, --all             Run all benchmark sizes
  -b, --baseline        Save results as baseline
  -c, --compare         Compare with saved baseline (detect >5% regressions)
  -o, --output <file>   Output JSON file path
  -j, --json            Output JSON to stdout
  -h, --help            Show this help

Examples:
  devforge-benchmark                    # Run small benchmark
  devforge-benchmark --size medium      # Run medium benchmark
  devforge-benchmark --all              # Run all sizes
  devforge-benchmark --all --baseline   # Save all as baselines
  devforge-benchmark --all --compare    # Compare all with baselines
`);
}

async function ensureDirs() {
  await mkdir(RESULTS_DIR, { recursive: true });
  await mkdir(BASELINES_DIR, { recursive: true });
}

async function saveBaseline(size: FixtureSize, results: BenchmarkResult[]) {
  const baseline = {
    timestamp: new Date().toISOString(),
    size,
    results,
  };
  
  const filePath = `${BASELINES_DIR}/${size}-baseline.json`;
  await writeFile(filePath, JSON.stringify(baseline, null, 2));
  console.log(`\n💾 Baseline saved: ${filePath}`);
}

async function loadBaseline(size: FixtureSize) {
  const filePath = `${BASELINES_DIR}/${size}-baseline.json`;
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function compareWithBaseline(result: BenchmarkResult, baseline: any): { regressed: boolean; details: string[] } {
  const baselineResult = baseline.results.find((r: BenchmarkResult) => r.fixture === result.fixture);
  if (!baselineResult) {
    return { regressed: false, details: [] };
  }
  
  const details: string[] = [];
  let regressed = false;
  const THRESHOLD = 0.05; // 5%
  
  const checkMetric = (name: string, current: number, baselineVal: number) => {
    if (baselineVal === 0) return;
    const diff = ((current - baselineVal) / baselineVal) * 100;
    if (diff > THRESHOLD * 100) {
      regressed = true;
      details.push(`${name}: ${baselineVal}ms → ${current}ms (+${diff.toFixed(1)}%)`);
    } else if (diff < -THRESHOLD * 100) {
      details.push(`${name}: ${baselineVal}ms → ${current}ms (${diff.toFixed(1)}%)`);
    }
  };
  
  checkMetric("Indexing", result.timings.indexingMs, baselineResult.timings.indexingMs);
  checkMetric("Metadata", result.timings.metadataMs, baselineResult.timings.metadataMs);
  checkMetric("Lang Detection", result.timings.languageDetectionMs, baselineResult.timings.languageDetectionMs);
  checkMetric("Parsing", result.timings.parsingMs, baselineResult.timings.parsingMs);
  checkMetric("Symbol Graph", result.timings.symbolGraphMs, baselineResult.timings.symbolGraphMs);
  checkMetric("Knowledge Graph", result.timings.knowledgeGraphMs, baselineResult.timings.knowledgeGraphMs);
  checkMetric("Total", result.timings.totalMs, baselineResult.timings.totalMs);
  
  const memDiff = ((result.memory.heapUsedMB - baselineResult.memory.heapUsedMB) / baselineResult.memory.heapUsedMB) * 100;
  if (memDiff > THRESHOLD * 100) {
    regressed = true;
    details.push(`Memory: ${baselineResult.memory.heapUsedMB}MB → ${result.memory.heapUsedMB}MB (+${memDiff.toFixed(1)}%)`);
  }
  
  return { regressed, details };
}

async function main() {
  const options = parseArgs();
  await ensureDirs();
  
  const size = options.size || "small";
  const sizesToRun: FixtureSize[] = options.all 
    ? (Object.keys(FIXTURES) as FixtureSize[])
    : [size];
  
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                    DevForge Performance Benchmark Suite                      ║
║                          Sizes: ${sizesToRun.join(", ").padEnd(48)}║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);
  
  const allResults: BenchmarkResult[] = [];
  
  for (const fixtureSize of sizesToRun) {
    const fixturePath = resolve(FIXTURES_DIR, FIXTURES[fixtureSize]);
    
    console.log(`\n▶ Running ${fixtureSize} benchmark...`);
    const results = await runMultipleBenchmarks(fixturePath, fixtureSize, 3);
    const medianResult = calculateMedian(results);
    allResults.push(medianResult);
    
    if (!options.json) {
      console.log(formatResult(medianResult));
    }
  }
  
  // Save latest results
  const latestResults = {
    timestamp: new Date().toISOString(),
    results: allResults,
  };
  
  await writeFile(`${RESULTS_DIR}/latest.json`, JSON.stringify(latestResults, null, 2));
  
  // Save individual results
  for (const result of allResults) {
    await writeFile(`${RESULTS_DIR}/${result.fixture}.json`, JSON.stringify(result, null, 2));
  }
  
  // Handle baseline operations
  if (options.baseline) {
    for (const fixtureSize of sizesToRun) {
      const sizeResults = allResults.filter(r => r.fixture === fixtureSize);
      await saveBaseline(fixtureSize, sizeResults);
    }
  }
  
  // Regression detection
  if (options.compare) {
    let hasRegressions = false;
    
    for (const fixtureSize of sizesToRun) {
      const baseline = await loadBaseline(fixtureSize);
      if (!baseline) {
        console.log(`\n⚠️  No baseline found for ${fixtureSize}. Run with --baseline first.`);
        continue;
      }
      
      const sizeResults = allResults.filter(r => r.fixture === fixtureSize);
      for (const result of sizeResults) {
        const { regressed, details } = compareWithBaseline(result, baseline);
        if (regressed) {
          hasRegressions = true;
          console.log(`\n⚠️  REGRESSION DETECTED in ${result.fixture}:`);
          for (const detail of details) {
            console.log(`   - ${detail}`);
          }
        } else {
          console.log(`\n✅ ${result.fixture}: No regressions (>5% threshold)`);
        }
      }
    }
    
    if (hasRegressions) {
      console.log(`\n❌ Regressions detected!`);
      process.exit(1);
    }
  }
  
  // Output JSON if requested
  if (options.json) {
    console.log(JSON.stringify(latestResults, null, 2));
  }
  
  if (options.output) {
    await writeFile(options.output, JSON.stringify(latestResults, null, 2));
    console.log(`\n📄 Results written to: ${options.output}`);
  }
  
  console.log(`\n📊 Results saved to: ${RESULTS_DIR}/`);
}

main().catch(console.error);
