
import fs from 'fs';

const path = './data/snapshot_optimized.json';
const snapshot = JSON.parse(fs.readFileSync(path, 'utf8'));
const totalSize = fs.statSync(path).size;

let rationaleSize = 0;
let memorySize = 0;
let perHistorySize = 0;
let tradeHistorySize = 0;
let chatSize = 0;
let marketDataSize = 0;

snapshot.agents.forEach((a: any) => {
    if (a.rationaleHistory) rationaleSize += JSON.stringify(a.rationaleHistory).length;
    if (a.memory) memorySize += JSON.stringify(a.memory).length;
    if (a.performanceHistory) perHistorySize += JSON.stringify(a.performanceHistory).length;
    if (a.tradeHistory) tradeHistorySize += JSON.stringify(a.tradeHistory).length;
});

if (snapshot.chat) chatSize += JSON.stringify(snapshot.chat).length;
if (snapshot.marketData) marketDataSize += JSON.stringify(snapshot.marketData).length;

const output = `
Total File Size: ${(totalSize / 1024 / 1024).toFixed(2)} MB
Rationale History: ${(rationaleSize / 1024 / 1024).toFixed(2)} MB (${(rationaleSize / totalSize * 100).toFixed(1)}%)
Memory: ${(memorySize / 1024 / 1024).toFixed(2)} MB (${(memorySize / totalSize * 100).toFixed(1)}%)
Performance History: ${(perHistorySize / 1024 / 1024).toFixed(2)} MB (${(perHistorySize / totalSize * 100).toFixed(1)}%)
Trade History: ${(tradeHistorySize / 1024 / 1024).toFixed(2)} MB (${(tradeHistorySize / totalSize * 100).toFixed(1)}%)
Chat: ${(chatSize / 1024 / 1024).toFixed(2)} MB (${(chatSize / totalSize * 100).toFixed(1)}%)
Market Data: ${(marketDataSize / 1024 / 1024).toFixed(2)} MB (${(marketDataSize / totalSize * 100).toFixed(1)}%)
Market Data Keys: ${snapshot.marketData ? Object.keys(snapshot.marketData).length : 0}
`;

fs.writeFileSync('analysis_result_v2.txt', output);
console.log('Analysis complete. Written to analysis_result_v2.txt');
