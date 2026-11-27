'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractLabCandidates } = require('../src/lib/lab-value-parser-enhanced');

test('attaches references on a separate line and keeps field labels out of test names', () => {
  const items = extractLabCandidates({ pages: [{ pageNumber: 1, lines: [
    { content: 'Glükóz 5.1 mmol/L' },
    { content: 'Referencia' },
    { content: '3.9-5.6 mmol/L' },
    { content: 'Koleszterin 4.6 mmol/L' },
    { content: 'Referencia: < 5.2 mmol/L' },
    { content: 'CRP 8 mg/L' },
    { content: 'Referencia < 5 mg/L' }
  ] }] });
  assert.equal(items.length, 3);
  assert.deepEqual(items.map(x => x.rawParameterName), ['Glükóz', 'Koleszterin', 'CRP']);
  assert.equal(items[0].referenceLow, 3.9);
  assert.equal(items[0].referenceHigh, 5.6);
  assert.equal(items[1].referenceRange, '<5.2');
  assert.equal(items[2].referenceRange, '<5');
  assert.equal(items[2].isAbnormal, true);
});

test('uses line geometry to attach a reference to the closest result, not OCR list order', () => {
  const line = (content, top, left = 1) => ({
    content,
    boundingRegions: [{ polygon: [left, top, left + 4, top, left + 4, top + 0.2, left, top + 0.2] }]
  });
  const items = extractLabCandidates({ pages: [{ pageNumber: 1, lines: [
    line('Glükóz 5.1 mmol/L', 1),
    line('Koleszterin 4.6 mmol/L', 3),
    line('Referencia: < 5.2 mmol/L', 3.25)
  ] }] });
  assert.equal(items.length, 2);
  assert.equal(items[0].referenceRange, null);
  assert.equal(items[1].referenceRange, '<5.2');
});

test('does not create laboratory items from generic OCR field headings and values', () => {
  const items = extractLabCandidates({ pages: [{ pageNumber: 1, lines: [
    { content: 'Vizsgálat neve' },
    { content: 'Eredmény' },
    { content: 'Eredmény 5.1' },
    { content: 'Mértékegység' },
    { content: 'Referencia-tartomány' }
  ] }] });
  assert.equal(items.length, 0);
});
