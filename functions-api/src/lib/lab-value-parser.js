'use strict';

const NUMBER_RE = /[<>≤≥]?\s*-?\d{1,8}(?:[.,]\d{1,6})?/;
const RANGE_RE = /(-?\d{1,8}(?:[.,]\d{1,6})?)\s*(?:-|–|—|\bto\b)\s*(-?\d{1,8}(?:[.,]\d{1,6})?)/i;

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

  const match = text.match(new RegExp('^(.{2,100}?)\\s+(' + NUMBER_RE.source + ')(.*)$', 'u'));
  if (!match) return null;

  const rawParameterName = match[1].trim().replace(/[|:;,.\s]+$/, '');
  const rawValue = match[2].trim();
  let tail = match[3].trim();
  if (rawParameterName.length < 2 || !/[a-záéíóöőúüű]/i.test(rawParameterName)) return null;
  if (/^(?:oldal|page|dátum|date|azonosító|taj|születési)/i.test(rawParameterName) ||
      /\b(?:mintavétel|dátum|date|azonosító|taj|születési|laboratórium|leletszám)\b/i.test(rawParameterName)) return null;

  const rangeMatch = tail.match(RANGE_RE);
  let referenceLow = null;
  let referenceHigh = null;
  let referenceRange = null;
  if (rangeMatch) {
    referenceLow = toNumber(rangeMatch[1]);
    referenceHigh = toNumber(rangeMatch[2]);
    if (referenceLow !== null && referenceHigh !== null && referenceLow <= referenceHigh) {
      referenceRange = rangeMatch[0].trim();
      tail = tail.replace(rangeMatch[0], ' ').trim();
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
  if (parsedNumericValue !== null && referenceLow !== null && referenceHigh !== null) {
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

function extractLabCandidates(analyzeResult) {
  const candidates = [];
  const pages = Array.isArray(analyzeResult?.pages) ? analyzeResult.pages : [];

  for (const page of pages) {
    const lines = Array.isArray(page.lines) ? page.lines : [];
    for (const line of lines) {
      const candidate = parseLabLine(line.content, page.pageNumber);
      if (candidate) candidates.push(candidate);
    }
  }

  // De-duplicate identical OCR lines while preserving page order.
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
