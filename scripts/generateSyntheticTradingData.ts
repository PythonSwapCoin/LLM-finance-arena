import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTradingDateFromStart } from '../shared/tradingDays';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const startDate = '2014-11-10T09:30:00-05:00'; // Monday
const tradingDays = 6; // Monday -> Monday (skip weekend)

const syntheticSeries = Array.from({ length: tradingDays }, (_, day) => {
  const tradingDate = getTradingDateFromStart(startDate, day);
  tradingDate.setHours(16, 0, 0, 0); // Use market close for plotting
  const label = tradingDate.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });

  return {
    dayIndex: day,
    iso: tradingDate.toISOString(),
    label,
    totalValue: 1_000_000 + day * 25_000 + Math.sin(day) * 5_000
  };
});

const outputDir = join(__dirname, 'output');
mkdirSync(outputDir, { recursive: true });
const outputPath = join(outputDir, 'synthetic_trading_data.json');

writeFileSync(
  outputPath,
  JSON.stringify({ startDate, points: syntheticSeries }, null, 2),
  'utf-8'
);

console.log(`Saved synthetic dataset with ${syntheticSeries.length} points to ${outputPath}`);
console.log('Preview:');
syntheticSeries.forEach(point => {
  console.log(`${point.label}: $${point.totalValue.toFixed(2)}`);
});
