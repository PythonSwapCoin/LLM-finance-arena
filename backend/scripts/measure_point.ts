
import fs from 'fs';

const path = './data/snapshot_fromNovrealdata-multi-model.json';
const snapshot = JSON.parse(fs.readFileSync(path, 'utf8'));

const point = snapshot.agents[0].performanceHistory[0];
const json = JSON.stringify(point);

console.log(`Single Point JSON: ${json}`);
console.log(`Size in bytes: ${json.length}`);

// Estimate size if we only kept timestamp and totalValue
const optimized = { t: point.timestamp, v: point.totalValue };
const optimizedJson = JSON.stringify(optimized);
console.log(`Optimized Point JSON: ${optimizedJson}`);
console.log(`Optimized Size: ${optimizedJson.length}`);
console.log(`Reduction: ${(1 - optimizedJson.length / json.length) * 100}%`);
