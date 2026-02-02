#!/usr/bin/env node
/**
 * Test script for Windows Ink recognition
 * Tests the new Windows Ink → LocalFoundry pipeline
 */

const fs = require('fs');
const path = require('path');

// Import built modules
const { recognizeWithWindowsInk } = require('./dist/ocr/windows-ink-recognizer');
const { cleanupHandwritingText } = require('./dist/ocr/handwriting-cleanup');
const { LocalFoundryClient } = require('./dist/services/localfoundry/localfoundry-client');

async function testWindowsInk() {
  console.log('=== Windows Ink Recognition Test ===\n');

  // Read the test InkML file
  const inkmlPath = path.join(__dirname, 'debug', 'inkml-raw.xml');

  if (!fs.existsSync(inkmlPath)) {
    console.error(`Error: Test file not found at ${inkmlPath}`);
    console.error('Please ensure debug/inkml-raw.xml exists');
    process.exit(1);
  }

  const inkmlXml = fs.readFileSync(inkmlPath, 'utf-8');
  console.log(`✓ Loaded InkML file (${inkmlXml.length} bytes)\n`);

  try {
    // Step 1: Windows Ink recognition
    console.log('Step 1: Running Windows Ink recognition...');
    const startInk = Date.now();
    const recognitionResult = await recognizeWithWindowsInk(inkmlXml, 0.7);
    const inkTime = Date.now() - startInk;

    console.log(`✓ Windows Ink complete (${inkTime}ms)`);
    console.log(`  - Words: ${recognitionResult.wordCount}`);
    console.log(`  - Lines: ${recognitionResult.lineCount}`);
    console.log(`  - Low confidence words: ${recognitionResult.lowConfidenceWords.length}`);
    console.log(`  - Raw text: "${recognitionResult.fullText}"\n`);

    if (recognitionResult.lowConfidenceWords.length > 0) {
      console.log('Low confidence words:');
      recognitionResult.lowConfidenceWords.forEach(item => {
        const percent = (item.confidence * 100).toFixed(0);
        console.log(`  - "${item.word}" (${percent}%) - alternatives: ${item.candidates.slice(0, 3).join(', ')}`);
      });
      console.log();
    }

    // Step 2: LocalFoundry cleanup
    console.log('Step 2: Running LocalFoundry cleanup...');

    const endpoint = process.env.LOCALFOUNDRY_ENDPOINT || 'http://localhost:8080/v1/chat/completions';
    const model = process.env.LOCALFOUNDRY_MODEL || 'phi-4';
    const timeout = parseInt(process.env.LOCALFOUNDRY_TIMEOUT || '120000', 10);

    console.log(`  - Endpoint: ${endpoint}`);
    console.log(`  - Model: ${model}`);

    const startCleanup = Date.now();
    const client = new LocalFoundryClient({ endpoint, model, timeout });
    const cleanedText = await cleanupHandwritingText(recognitionResult, client);
    const cleanupTime = Date.now() - startCleanup;

    console.log(`✓ LocalFoundry cleanup complete (${cleanupTime}ms)`);
    console.log(`  - Cleaned text: "${cleanedText}"\n`);

    // Summary
    const totalTime = Date.now() - startInk;
    console.log('=== Summary ===');
    console.log(`Total processing time: ${totalTime}ms`);
    console.log(`Windows Ink time: ${inkTime}ms (${((inkTime / totalTime) * 100).toFixed(1)}%)`);
    console.log(`LocalFoundry cleanup time: ${cleanupTime}ms (${((cleanupTime / totalTime) * 100).toFixed(1)}%)`);
    console.log('\n✓ Test completed successfully!');

  } catch (error) {
    console.error('\n✗ Test failed:');
    console.error(error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run test
testWindowsInk().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
