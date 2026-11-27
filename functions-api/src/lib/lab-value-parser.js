'use strict';

const NUMBER_RE = /[<>≤≥]?\s*-?\d{1,8}(?:[.,]\d{1,6})?/;
const RANGE_RE = /(-?\d{1,8}(?:[.,]\d{1,6})?)\s*(?:-|–|—|\bto\b)\s*(-?\d{1,8}(?:[.,]\d{1,6})?)/i;
const LIMIT_RE = /(?:([<>≤≥])\s*(-?\d{1,8}(?:[.,]\d{1,6})?)|(-?\d{1,8}(?:[.,]\d{1,6})?)\s*([<>≤≥]))/;

function toNumber(value) {
  if (typeof value !== 'string') return null;
  if (/[<>≤≥]/.test(value)) return null;
  const normalized = value.replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function parseLabLine(line, pageNumber) {
  const text = String(line || '').replace(/\s+/g, ' ').trim();
  if (text.length < 5 || text.length > 300) return null;

  const match = text.match(/^(.{2,100}?)\s+([<>≤≥]?\s*-?\d{1,8}(?:[.,]\d{1,6})?)(.*)$/u);
  if (!match) return null;

  const rawParameterName = match[1].trim().replace(/[|:;,.\s]+$/, '');
  const rawValue = match[2].trim();
  let tail = match[3].trim();
  if (rawParameterName.length < 2 || !/[a-záéíóöőúüű]/i.test(rawParameterName)) return null;
  if (/^(?:oldal|page|dátum|date|azonosító|taj|születési)/i.test(rawParameterName) ||
      /\b(?:mintavétel|dátum|date|azonosító|taj|születési|laboratórium|leletszám)\b/i.test(rawParameterName)) return null;

  let referenceLow = null;
  let referenceHigh = null;
  let referenceRange = null;
  let referenceLimit = null;
  const limitMatch = tail.match(LIMIT_RE);
  if (limitMatch) {
    const isSuffix = Boolean(limitMatch[4]);
    const rawOperator = limitMatch[1] || limitMatch[4];
    const rawLimit = limitMatch[2] || limitMatch[3];
    const limit = toNumber(rawLimit);
    if (limit !== null) {
      const inverseOperator = { '<': '>', '>': '<', '≤': '≥', '≥': '≤' };
      referenceLimit = isSuffix ? inverseOperator[rawOperator] : rawOperator;
      referenceRange = referenceLimit + rawLimit.replace(',', '.');
      if (referenceLimit === '<' || referenceLimit === '≤') referenceHigh = limit;
      else referenceLow = limit;
      tail = tail.replace(limitMatch[0], ' ').trim();
    }
  } else {
    const rangeMatch = tail.match(RANGE_RE);
    if (rangeMatch) {
      referenceLow = toNumber(rangeMatch[1]);
      referenceHigh = toNumber(rangeMatch[2]);
      if (referenceLow !== null && referenceHigh !== null && referenceLow <= referenceHigh) {
        referenceRange = rangeMatch[0].trim().replace(/\s*(?:-|–|—|\bto\b)\s*/i, '–');
        tail = tail.replace(rangeMatch[0], ' ').trim();
      }
    }
  }

  const unit = tail
    .replace(/(?:^|\s)(?:H|L|HIGH|LOW|magas|alacsony|emelkedett|csökkent)(?=\s|$)/gi, ' ')
    .replace(/[()\[\],;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50) || null;

  const parsedNumericValue = toNumber(rawValue);
  let isAbnormal = null;
  if (parsedNumericValue !== null && referenceLimit) {
    isAbnormal = referenceLimit === '<' ? parsedNumericValue >= referenceHigh
      : referenceLimit === '≤' ? parsedNumericValue > referenceHigh
      : referenceLimit === '>' ? parsedNumericValue <= referenceLow
      : parsedNumericValue < referenceLow;
  } else if (parsedNumericValue !== null && referenceLow !== null && referenceHigh !== null) {
    isAbnormal = parsedNumericValue < referenceLow || parsedNumericValue > referenceHigh;
  } else if (/(?:^|\s)(?:H|HIGH|magas|emelkedett)(?=\s|$)/i.test(text)) {
    isAbnormal = true;
  } else if (/(?:^|\s)(?:L|LOW|alacsony|csökkent)(?=\s|$)/i.test(text)) {
    isAbnormal = true;
  }

  return {
    sourcePageNumber: Number.isInteger(pageNumber) ? pageNumber : null,
    rawParameterName: rawParameterName.slice(0, 200),
    rawValue: rawValue.slice(0, 200),
    parsedNumericValue,
    unit,
    referenceRange,
    referenceLow,
    referenceHigh,
    isAbnormal
  };
}

function parseStandaloneReference(line) {
  const text = String(line || '').replace(/\s+/g, ' ').trim();
  const match = text.match(/^referencia(?:-tartomány)?\s*[:：]?\s*(.+)$/i);
  if (!match) return null;

  const value = match[1].trim();
  const compound = value.match(/([<>≤≥])\s*(-?\d{1,8}(?:[.,]\d{1,6})?)\s*(?:és|and)\s*([<>≤≥])\s*(-?\d{1,8}(?:[.,]\d{1,6})?)/i);
  if (compound) {
    const first = toNumber(compound[2]);
    const second = toNumber(compound[4]);
    if (first === null || second === null) return null;
    const bounds = [
      { operator: compound[1], value: first },
      { operator: compound[3], value: second }
    ];
    const lower = bounds.find(bound => bound.operator === '>' || bound.operator === '≥');
    const upper = bounds.find(bound => bound.operator === '<' || bound.operator === '≤');
    if (!lower || !upper || lower.value > upper.value) return null;
    return {
      referenceRange: value.replace(/\s+/g, ' '),
      referenceLow: lower.value,
      referenceHigh: upper.value
    };
  }

  const limit = value.match(/^([<>≤≥])\s*(-?\d{1,8}(?:[.,]\d{1,6})?)/);
  if (limit) {
    const number = toNumber(limit[2]);
    if (number === null) return null;
    return {
      referenceRange: limit[1] + limit[2].replace(',', '.'),
      referenceLow: limit[1] === '>' || limit[1] === '≥' ? number : null,
      referenceHigh: limit[1] === '<' || limit[1] === '≤' ? number : null
    };
  }

  const range = value.match(RANGE_RE);
  if (range) {
    const low = toNumber(range[1]);
    const high = toNumber(range[2]);
    if (low === null || high === null || low > high) return null;
    return {
      referenceRange: range[0].trim().replace(/\s*(?:-|–|—|\bto\b)\s*/i, '–'),
      referenceLow: low,
      referenceHigh: high
    };
  }
  return null;
}

function updateAbnormality(candidate) {
  if (candidate.parsedNumericValue === null) return;
  if (candidate.referenceLow !== null && candidate.referenceHigh !== null) {
    candidate.isAbnormal = candidate.parsedNumericValue < candidate.referenceLow ||
      candidate.parsedNumericValue > candidate.referenceHigh;
  } else if (candidate.referenceHigh !== null) {
    candidate.isAbnormal = candidate.referenceRange.startsWith('<')
      ? candidate.parsedNumericValue >= candidate.referenceHigh
      : candidate.parsedNumericValue > candidate.referenceHigh;
  } else if (candidate.referenceLow !== null) {
    candidate.isAbnormal = candidate.referenceRange.startsWith('>')
      ? candidate.parsedNumericValue <= candidate.referenceLow
      : candidate.parsedNumericValue < candidate.referenceLow;
  }
}

function extractLabCandidates(analyzeResult) {
  const candidates = [];
  const pages = Array.isArray(analyzeResult?.pages) ? analyzeResult.pages : [];

  for (const page of pages) {
    const lines = Array.isArray(page.lines) ? page.lines : [];
    for (const line of lines) {
      const reference = parseStandaloneReference(line.content);
      if (reference) {
        const previous = candidates[candidates.length - 1];
        if (previous && previous.sourcePageNumber === page.pageNumber) {
          previous.referenceRange = reference.referenceRange;
          previous.referenceLow = reference.referenceLow;
          previous.referenceHigh = reference.referenceHigh;
          updateAbnormality(previous);
        }
        continue;
      }
      const candidate = parseLabLine(line.content, page.pageNumber);
      if (candidate) candidates.push(candidate);
    }
  }

  const seen = new Set();
  return candidates.filter(candidate => {
    const key = [
      candidate.sourcePageNumber,
      candidate.rawParameterName.toLocaleLowerCase('hu-HU'),
      candidate.rawValue,
      candidate.unit
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 500);
}

module.exports = { extractLabCandidates, parseLabLine, toNumber };
