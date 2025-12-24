
import fs from 'fs';

const path = './data/snapshot_fromNovrealdata-multi-model.json';
const snapshot = JSON.parse(fs.readFileSync(path, 'utf8'));

const agent = snapshot.agents[0];
const history = agent.performanceHistory;

console.log(`Total points: ${history.length}`);

if (history.length > 1) {
    const intervals: number[] = [];
    let sameValueCount = 0;

    // Check keys in a single point
    console.log('Keys in a single point:', Object.keys(history[0]));

    for (let i = 1; i < history.length; i++) {
        const diff = history[i].timestamp - history[i - 1].timestamp;
        intervals.push(diff);

        if (history[i].totalValue === history[i - 1].totalValue) {
            sameValueCount++;
        }
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const minInterval = Math.min(...intervals);
    const maxInterval = Math.max(...intervals);

    console.log(`Average Interval: ${avgInterval.toFixed(2)} ms`);
    console.log(`Min Interval: ${minInterval} ms`);
    console.log(`Max Interval: ${maxInterval} ms`);
    console.log(`Points with unchanged Total Value: ${sameValueCount} (${(sameValueCount / history.length * 100).toFixed(1)}%)`);

    console.log('--- Sample Points ---');
    console.log(JSON.stringify(history.slice(0, 3), null, 2));
}
