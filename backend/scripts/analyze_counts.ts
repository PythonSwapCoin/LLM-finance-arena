
import fs from 'fs';

const path = './data/snapshot_fromNovrealdata-multi-model.json';
const snapshot = JSON.parse(fs.readFileSync(path, 'utf8'));

console.log(`Agent Count: ${snapshot.agents.length}`);
console.log(`Benchmark Count: ${snapshot.benchmarks ? snapshot.benchmarks.length : 0}`);

const pointsPerAgent = snapshot.agents.map((a: any) => a.performanceHistory.length);
const totalPoints = pointsPerAgent.reduce((a: number, b: number) => a + b, 0);

console.log(`Avg Points per Agent: ${totalPoints / snapshot.agents.length}`);
console.log(`Total Points to Render: ${totalPoints}`);
