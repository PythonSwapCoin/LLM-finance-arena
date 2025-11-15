/**
 * Test script to check Yahoo Finance rate limits
 * Run with: npx tsx backend/test-yfinance-limits.ts
 */

import { Ticker } from './src/services/yfinanceService';

const TEST_TICKERS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA'];

async function testYahooFinanceLimits() {
  console.log('🧪 Testing Yahoo Finance Rate Limits\n');
  console.log(`Testing ${TEST_TICKERS.length} tickers with different delay intervals...\n`);

  // Test 1: No delay (baseline - will likely fail)
  console.log('Test 1: No delay between requests');
  console.log('-----------------------------------');
  let successCount = 0;
  let failCount = 0;
  const startTime = Date.now();
  
  for (let i = 0; i < TEST_TICKERS.length; i++) {
    const ticker = TEST_TICKERS[i];
    try {
      const yfTicker = new Ticker(ticker);
      const fastInfo = await yfTicker.fastInfo();
      console.log(`✅ ${ticker}: $${fastInfo.price.toFixed(2)}`);
      successCount++;
    } catch (error) {
      console.log(`❌ ${ticker}: ${error instanceof Error ? error.message : String(error)}`);
      failCount++;
    }
  }
  
  const elapsed = Date.now() - startTime;
  console.log(`\nResults: ${successCount} success, ${failCount} failed, ${elapsed}ms elapsed\n`);

  // Wait 10 seconds before next test
  console.log('Waiting 10 seconds before next test...\n');
  await new Promise(resolve => setTimeout(resolve, 10000));

  // Test 2: 1 second delay
  console.log('Test 2: 1 second delay between requests');
  console.log('----------------------------------------');
  successCount = 0;
  failCount = 0;
  const startTime2 = Date.now();
  
  for (let i = 0; i < TEST_TICKERS.length; i++) {
    const ticker = TEST_TICKERS[i];
    try {
      const yfTicker = new Ticker(ticker);
      const fastInfo = await yfTicker.fastInfo();
      console.log(`✅ ${ticker}: $${fastInfo.price.toFixed(2)}`);
      successCount++;
    } catch (error) {
      console.log(`❌ ${ticker}: ${error instanceof Error ? error.message : String(error)}`);
      failCount++;
    }
    
    if (i < TEST_TICKERS.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  const elapsed2 = Date.now() - startTime2;
  console.log(`\nResults: ${successCount} success, ${failCount} failed, ${elapsed2}ms elapsed\n`);

  // Wait 10 seconds before next test
  console.log('Waiting 10 seconds before next test...\n');
  await new Promise(resolve => setTimeout(resolve, 10000));

  // Test 3: 2.5 second delay (our current setting)
  console.log('Test 3: 2.5 second delay between requests');
  console.log('------------------------------------------');
  successCount = 0;
  failCount = 0;
  const startTime3 = Date.now();
  
  for (let i = 0; i < TEST_TICKERS.length; i++) {
    const ticker = TEST_TICKERS[i];
    try {
      const yfTicker = new Ticker(ticker);
      const fastInfo = await yfTicker.fastInfo();
      console.log(`✅ ${ticker}: $${fastInfo.price.toFixed(2)}`);
      successCount++;
    } catch (error) {
      console.log(`❌ ${ticker}: ${error instanceof Error ? error.message : String(error)}`);
      failCount++;
    }
    
    if (i < TEST_TICKERS.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2500));
    }
  }
  
  const elapsed3 = Date.now() - startTime3;
  console.log(`\nResults: ${successCount} success, ${failCount} failed, ${elapsed3}ms elapsed\n`);

  // Wait 10 seconds before next test
  console.log('Waiting 10 seconds before next test...\n');
  await new Promise(resolve => setTimeout(resolve, 10000));

  // Test 4: 5 second delay (very conservative)
  console.log('Test 4: 5 second delay between requests');
  console.log('----------------------------------------');
  successCount = 0;
  failCount = 0;
  const startTime4 = Date.now();
  
  for (let i = 0; i < TEST_TICKERS.length; i++) {
    const ticker = TEST_TICKERS[i];
    try {
      const yfTicker = new Ticker(ticker);
      const fastInfo = await yfTicker.fastInfo();
      console.log(`✅ ${ticker}: $${fastInfo.price.toFixed(2)}`);
      successCount++;
    } catch (error) {
      console.log(`❌ ${ticker}: ${error instanceof Error ? error.message : String(error)}`);
      failCount++;
    }
    
    if (i < TEST_TICKERS.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  
  const elapsed4 = Date.now() - startTime4;
  console.log(`\nResults: ${successCount} success, ${failCount} failed, ${elapsed4}ms elapsed\n`);

  console.log('\n📊 Summary:');
  console.log('Test 1 (no delay):', successCount > 0 ? '✅ Some success' : '❌ All failed');
  console.log('Test 2 (1s delay):', successCount > 0 ? '✅ Some success' : '❌ All failed');
  console.log('Test 3 (2.5s delay):', successCount > 0 ? '✅ Some success' : '❌ All failed');
  console.log('Test 4 (5s delay):', successCount > 0 ? '✅ Some success' : '❌ All failed');
  console.log('\n💡 Recommendation: Use the delay that gives 100% success rate');
}

testYahooFinanceLimits().catch(console.error);


