'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLabLine, extractLabCandidates, toNumber } = require('../src/lib/lab-value-parser');

test('parses Hungarian laboratory result, unit and reference interval', () => {
  const item = parseLabLine('Glükóz 5,1 mmol/L 3,9 - 6,1', 1);
  assert.equal(item.rawParameterName, 'Glükóz');
  assert.equal(item.parsedNumericValue, 5.1);
  assert.equal(item.unit, 'mmol/L');
  assert.equal(item.referenceLow, 3.9);
  assert.equal(item.referenceHigh, 6.1);
  assert.equal(item.isAbnormal, false);
});

test('marks a numeric value outside the supplied reference interval', () => {
  const item = parseLabLine('Koleszterin 7,2 mmol/L 3,0-5,2', 2);
  assert.equal(item.isAbnormal, true);
});

test('keeps non-numeric result text instead of coercing it to zero', () => {
  const item = parseLabLine('Vércsoport 0 Rh pozitív', 1);
  assert.equal(item, null);
  assert.equal(toNumber('<0,1'), null);
});

test('ignores duplicate OCR lines and preserves source page', () => {
  const items = extractLabCandidates({
    pages: [{
      pageNumber: 1,
      lines: [
        { content: 'Glükóz 5,1 mmol/L 3,9 - 6,1' },
        { content: 'Glükóz 5,1 mmol/L 3,9 - 6,1' }
      ]
    }]
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].sourcePageNumber, 1);
});
