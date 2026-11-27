'use strict';

const { parseLabLine } = require('./lab-value-parser');

const NUMBER = '-?\\d{1,8}(?:[.,]\\d{1,6})?';
const FIELD_LABEL = /^(?:vizsgálat(?: neve)?|eredmény|eredmeny|mértékegység|mertekegyseg|referencia(?:-tartomány|-tartom(?:ány)?)?|egység|unit|result|test name)$/i;

function numberOf(value) {
  const normalized = String(value || '').replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

function parseReference(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const compound = text.match(new RegExp('([<>≤≥])\\s*(' + NUMBER + ')\\s*(?:és|and)\\s*([<>≤≥])\\s*(' + NUMBER + ')', 'i'));
  if (compound) {
    const a = numberOf(compound[2]);
    const b = numberOf(compound[4]);
    const lower = [{ op: compound[1], n: a }, { op: compound[3], n: b }].find(x => x.op === '>' || x.op === '≥');
    const upper = [{ op: compound[1], n: a }, { op: compound[3], n: b }].find(x => x.op === '<' || x.op === '≤');
    if (!lower || !upper || lower.n === null || upper.n === null || lower.n > upper.n) return null;
    return { referenceRange: text, referenceLow: lower.n, referenceHigh: upper.n };
  }
  const limit = text.match(new RegExp('^([<>≤≥])\\s*(' + NUMBER + ')'));
  if (limit) {
    const n = numberOf(limit[2]);
    if (n === null) return null;
    return {
      referenceRange: limit[1] + limit[2].replace(',', '.'),
      referenceLow: limit[1] === '>' || limit[1] === '≥' ? n : null,
      referenceHigh: limit[1] === '<' || limit[1] === '≤' ? n : null
    };
  }
  const range = text.match(new RegExp('(' + NUMBER + ')\\s*(?:-|–|—|\\bto\\b)\\s*(' + NUMBER + ')', 'i'));
  if (!range) return null;
  const low = numberOf(range[1]);
  const high = numberOf(range[2]);
  if (low === null || high === null || low > high) return null;
  return { referenceRange: range[0].replace(/\s*(?:-|–|—|\bto\b)\s*/i, '–'), referenceLow: low, referenceHigh: high };
}

function boundsOf(line) {
  const polygon = line && line.boundingRegions && line.boundingRegions[0] && line.boundingRegions[0].polygon;
  if (!Array.isArray(polygon) || polygon.length < 8) return null;
  const xs = [];
  const ys = [];
  for (let i = 0; i + 1 < polygon.length; i += 2) {
    xs.push(Number(polygon[i]));
    ys.push(Number(polygon[i + 1]));
  }
  if (!xs.every(Number.isFinite) || !ys.every(Number.isFinite)) return null;
  const left = Math.min(...xs), right = Math.max(...xs);
  const top = Math.min(...ys), bottom = Math.max(...ys);
  return { left, right, top, bottom, cx: (left + right) / 2, cy: (top + bottom) / 2 };
}

function attachReference(reference, candidates) {
  const samePage = candidates.filter(x => x.page === reference.page);
  if (!samePage.length) return;
  if (!reference.bounds) {
    const previous = samePage.filter(x => x.index < reference.index).sort((a, b) => b.index - a.index)[0];
    if (previous) previous.item.reference = reference.value;
    return;
  }
  const ranked = samePage.map(candidate => {
    if (!candidate.bounds) return { candidate, score: Infinity };
    const a = candidate.bounds, b = reference.bounds;
    const vertical = b.top >= a.bottom ? b.top - a.bottom : a.top >= b.bottom ? a.top - b.bottom : 0;
    const horizontal = b.left > a.right ? b.left - a.right : a.left > b.right ? a.left - b.right : 0;
    const candidateAbove = a.cy <= b.cy;
    return { candidate, score: vertical * 4 + horizontal + (candidateAbove ? 0 : 1000) };
  }).sort((a, b) => a.score - b.score);
  if (ranked[0] && ranked[0].score < 1000) ranked[0].candidate.item.reference = reference.value;
}

function extractLabCandidates(analyzeResult) {
  const candidates = [];
  const references = [];
  const pages = Array.isArray(analyzeResult && analyzeResult.pages) ? analyzeResult.pages : [];

  for (const page of pages) {
    const lines = Array.isArray(page.lines) ? page.lines : [];
    let referenceLabelPending = false;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const text = String(line && line.content || '').replace(/\s+/g, ' ').trim();
      const bounds = boundsOf(line);
      const label = text.match(/^referencia(?:-tartomány|-tartom(?:ány)?)?\s*[:：]?\s*(.*)$/i);
      if (label) {
        const parsed = parseReference(label[1]);
        if (parsed) references.push({ page: page.pageNumber, index, bounds, value: parsed });
        else referenceLabelPending = true;
        continue;
      }
      if (referenceLabelPending) {
        const parsed = parseReference(text);
        if (parsed) {
          references.push({ page: page.pageNumber, index, bounds, value: parsed });
          referenceLabelPending = false;
          continue;
        }
        referenceLabelPending = false;
      }
      if (FIELD_LABEL.test(text)) continue;
      const item = parseLabLine(text, page.pageNumber);
      if (!item || FIELD_LABEL.test(item.rawParameterName)) continue;
      candidates.push({ item, page: page.pageNumber, index, bounds });
    }
  }

  for (const reference of references) attachReference(reference, candidates);

  for (const candidate of candidates) {
    const ref = candidate.item.reference;
    if (!ref) continue;
    candidate.item.referenceRange = ref.referenceRange;
    candidate.item.referenceLow = ref.referenceLow;
    candidate.item.referenceHigh = ref.referenceHigh;
    const value = candidate.item.parsedNumericValue;
    if (value !== null) {
      if (ref.referenceLow !== null && ref.referenceHigh !== null) {
        candidate.item.isAbnormal = value < ref.referenceLow || value > ref.referenceHigh;
      } else if (ref.referenceHigh !== null) {
        candidate.item.isAbnormal = value >= ref.referenceHigh;
      } else if (ref.referenceLow !== null) {
        candidate.item.isAbnormal = value <= ref.referenceLow;
      }
    }
    delete candidate.item.reference;
  }

  const seen = new Set();
  return candidates.map(x => x.item).filter(item => {
    const key = [item.sourcePageNumber, item.rawParameterName.toLocaleLowerCase('hu-HU'), item.rawValue, item.unit].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 500);
}

module.exports = { extractLabCandidates };
