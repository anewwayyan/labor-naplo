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
  const item = parseLabLine('Vércsoport A pozitív', 1);
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

test('does not treat the L in mg/L as a low-result flag', () => {
  const item = parseLabLine('CRP 2 mg/L 0-5', 1);
  assert.equal(item.unit, 'mg/L');
  assert.equal(item.isAbnormal, false);
});

test('recognizes a standalone high flag after the unit', () => {
  const item = parseLabLine('CRP 8 mg/L 0-5 H', 1);
  assert.equal(item.unit, 'mg/L');
  assert.equal(item.isAbnormal, true);
});

test('ignores collection date and report metadata lines', () => {
  assert.equal(parseLabLine('Mintavétel dátuma 2026-11-26', 1), null);
  assert.equal(parseLabLine('Leletszám 123456', 1), null);
});

test('parses exclusive and inclusive inequality reference limits', () => {
  const below = parseLabLine('Koleszterin 4,6 mmol/L <5', 1);
  assert.equal(below.referenceRange, '<5');
  assert.equal(below.referenceHigh, 5);
  assert.equal(below.isAbnormal, false);

  const above = parseLabLine('Hemoglobin 145 g/L >120', 1);
  assert.equal(above.referenceRange, '>120');
  assert.equal(above.referenceLow, 120);
  assert.equal(above.isAbnormal, false);

  assert.equal(parseLabLine('Koleszterin 5 mmol/L <5', 1).isAbnormal, true);
  assert.equal(parseLabLine('Hemoglobin 120 g/L >120', 1).isAbnormal, true);
});

test('normalizes a hyphen reference interval to an en dash', () => {
  const item = parseLabLine('Glükóz 5,1 mmol/L 4-5', 1);
  assert.equal(item.referenceRange, '4–5');
  assert.equal(item.isAbnormal, true);
});
