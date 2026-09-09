import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tokenizeSourceFile,
  isWindowQualifying,
  hashTokenWindow,
  mergeIntervals,
  DEFAULT_MIN_TOKEN_THRESHOLD,
  DEFAULT_MIN_LINE_THRESHOLD
} from '../src/services/intelligence/duplicationEngine.js';

test('Duplication Tokenizer & Normalization', async (t) => {
  await t.test('tokenizes JavaScript source and normalizes identifiers and literals', () => {
    const code = `
      function calculateTotal(items, taxRate) {
        let total = 0;
        for (let i = 0; i < items.length; i++) {
          total += items[i].price * (1 + taxRate);
        }
        return total;
      }
    `;

    const tokens = tokenizeSourceFile({
      path: 'src/billing.js',
      content: code,
      language: 'javascript'
    });

    assert.ok(tokens.length > 0, 'Expected tokens to be extracted');

    // Verify keywords preserved
    const keywords = tokens.filter(t => t.category === 'keyword');
    const kwSet = new Set(keywords.map(k => k.normalized));
    assert.ok(kwSet.has('kw:function'), 'Should contain kw:function');
    assert.ok(kwSet.has('kw:for'), 'Should contain kw:for');
    assert.ok(kwSet.has('kw:return'), 'Should contain kw:return');

    // Verify identifiers normalized to $ID
    const identifiers = tokens.filter(t => t.category === 'identifier');
    assert.ok(identifiers.length > 0, 'Should identify variable/function names');
    assert.ok(identifiers.every(i => i.normalized === '$ID'), 'All identifiers must normalize to $ID');

    // Verify literals normalized to $LIT
    const literals = tokens.filter(t => t.category === 'literal');
    assert.ok(literals.length > 0, 'Should identify numeric literals');
    assert.ok(literals.every(l => l.normalized === '$LIT'), 'All literals must normalize to $LIT');
  });

  await t.test('filters out comments and whitespace', () => {
    const codeWithComments = `
      // Single line header comment
      function processOrder(orderId) {
        /* Multi-line block comment
           explaining logic */
        const status = "COMPLETED";
        return status;
      }
    `;

    const codeWithoutComments = `
      function processOrder(orderId) {
        const status = "COMPLETED";
        return status;
      }
    `;

    const tokensWith = tokenizeSourceFile({ path: 'src/order1.js', content: codeWithComments });
    const tokensWithout = tokenizeSourceFile({ path: 'src/order2.js', content: codeWithoutComments });

    const normWith = tokensWith.map(t => t.normalized).join('|');
    const normWithout = tokensWithout.map(t => t.normalized).join('|');

    assert.equal(normWith, normWithout, 'Normalized token streams must be identical regardless of comments');
  });

  await t.test('skips import declarations to avoid trivial boilerplate duplication', () => {
    const code = `
      import React, { useState, useEffect } from 'react';
      import { formatMoney } from '../utils/money.js';

      function renderReceipt(amount) {
        const tax = 0.08;
        return amount * (1 + tax);
      }
    `;

    const tokens = tokenizeSourceFile({ path: 'src/receipt.js', content: code });
    const hasImportToken = tokens.some(t => t.normalized === 'kw:import' || t.raw === 'react');

    assert.equal(hasImportToken, false, 'Import tokens should be excluded from clone token stream');
  });

  await t.test('identifies qualifying windows based on line span and semantic density', () => {
    // Window on a single line -> disqualified (lineSpan < 4)
    const singleLineWindow = Array(45).fill(null).map((_, i) => ({
      category: 'identifier',
      normalized: '$ID',
      startLine: 1,
      endLine: 1
    }));
    assert.equal(isWindowQualifying(singleLineWindow, 4), false, 'Single line window must not qualify');

    // Punctuation heavy window -> disqualified
    const punctuationWindow = Array(45).fill(null).map((_, i) => ({
      category: i < 5 ? 'keyword' : 'delimiter',
      normalized: i < 5 ? 'kw:if' : 'del:;',
      startLine: 1,
      endLine: 8
    }));
    assert.equal(isWindowQualifying(punctuationWindow, 4), false, 'Punctuation heavy window must not qualify');

    // Qualifying semantic window
    const qualifyingWindow = Array(45).fill(null).map((_, i) => ({
      category: i % 2 === 0 ? 'keyword' : 'identifier',
      normalized: i % 2 === 0 ? 'kw:let' : '$ID',
      startLine: 1,
      endLine: 10
    }));
    assert.equal(isWindowQualifying(qualifyingWindow, 4), true, 'Semantic multi-line window must qualify');
  });

  await t.test('hashTokenWindow produces deterministic 16-character hex hash', () => {
    const tokens = [
      { normalized: 'kw:function' },
      { normalized: '$ID' },
      { normalized: 'del:(' },
      { normalized: '$ID' },
      { normalized: 'del:)' }
    ];

    const hash1 = hashTokenWindow(tokens);
    const hash2 = hashTokenWindow(tokens);

    assert.equal(hash1, hash2, 'Hash must be 100% deterministic');
    assert.equal(hash1.length, 16, 'Hash must be 16 hex characters');
  });

  await t.test('mergeIntervals unions overlapping and adjacent line spans correctly', () => {
    const input = [
      [10, 20],
      [15, 25], // overlaps with [10, 20] -> [10, 25]
      [26, 30], // adjacent to 25 -> [10, 30]
      [50, 60], // disjoint
      [55, 65]  // overlaps -> [50, 65]
    ];

    const merged = mergeIntervals(input);
    assert.deepEqual(merged, [
      [10, 30],
      [50, 65]
    ]);

    // Sum of distinct duplicated lines: (30 - 10 + 1) + (65 - 50 + 1) = 21 + 16 = 37 lines
    const totalLines = merged.reduce((acc, [start, end]) => acc + (end - start + 1), 0);
    assert.equal(totalLines, 37, 'Line union must calculate exact non-overlapping line sum');
  });
});
