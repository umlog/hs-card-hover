// Pure functions: build a name -> cards index from HearthstoneJSON data and
// find the card name under a given character offset. No chrome.* access here
// so this file can be exercised directly from Node.

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 48;
const MAX_CARDS_PER_NAME = 8;

const BATTLEGROUNDS_SET = 'BATTLEGROUNDS';
const EXCLUDED_TYPES = new Set([
  'ENCHANTMENT',
  'LETTUCE_ABILITY',
  'GAME_MODE_BUTTON',
  'MOVE_MINION_HOVER_TARGET',
]);

// Lower rank = more likely to be the card a reader means.
const RANK_PRIMARY = 0;
const RANK_BATTLEGROUNDS_OTHER = 1;
const RANK_OTHER = 2;

const WORD_CHAR = /[\p{L}\p{N}]/u;
const TIER_HINT = /^\s*\(\s*(\d)\s*단계\s*\)/;

export function normalizeName(name) {
  return name.normalize('NFC').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

function isBattlegrounds(card) {
  return card.set === BATTLEGROUNDS_SET || String(card.type).startsWith('BATTLEGROUND_');
}

function rankOf(card) {
  if (card.collectible) return RANK_PRIMARY;
  if (!isBattlegrounds(card)) return RANK_OTHER;
  const isPlayable =
    card.isBattlegroundsPoolMinion ||
    card.battlegroundsPremiumDbfId ||
    String(card.type).startsWith('BATTLEGROUND_') ||
    card.type === 'HERO';
  return isPlayable ? RANK_PRIMARY : RANK_BATTLEGROUNDS_OTHER;
}

/**
 * @param {Array<object>} cards HearthstoneJSON cards.json content
 * @returns {{names: Record<string, Array<[string, number, number]>>, maxLength: number, cardCount: number}}
 *   names maps a card name to [cardId, isBattlegrounds (0|1), tavernTier (0 if none)] tuples.
 */
export function buildIndex(cards) {
  const ranked = new Map();
  for (const card of cards) {
    if (!card.name || !card.type || EXCLUDED_TYPES.has(card.type)) continue;
    // Golden Battlegrounds copies share the name of the normal card.
    if (card.battlegroundsNormalDbfId) continue;
    const name = normalizeName(card.name);
    if (name.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH) continue;
    const entry = { rank: rankOf(card), tuple: [card.id, isBattlegrounds(card) ? 1 : 0, card.techLevel || 0] };
    if (!ranked.has(name)) ranked.set(name, []);
    ranked.get(name).push(entry);
  }

  const names = {};
  let maxLength = 0;
  let cardCount = 0;
  for (const [name, entries] of ranked) {
    const bestRank = Math.min(...entries.map((entry) => entry.rank));
    const kept = entries
      .filter((entry) => entry.rank === bestRank)
      .slice(0, MAX_CARDS_PER_NAME)
      .map((entry) => entry.tuple);
    names[name] = kept;
    cardCount += kept.length;
    maxLength = Math.max(maxLength, name.length);
  }
  return { names, maxLength, cardCount };
}

function filterByTierHint(cards, textAfterName) {
  const hint = TIER_HINT.exec(textAfterName);
  if (!hint) return cards;
  const tier = Number(hint[1]);
  const matching = cards.filter(([, , cardTier]) => cardTier === tier);
  return matching.length > 0 ? matching : cards;
}

/**
 * Finds the longest card name in `text` that covers the character at `offset`.
 * A name must start at a word boundary; it may be followed by anything, since
 * Korean particles attach directly to the name.
 *
 * @param {Map<string, Array<[string, number, number]>>} names
 * @param {number} maxLength
 * @param {string} text
 * @param {number} offset
 * @returns {{start: number, end: number, name: string, cards: Array<{id: string, battlegrounds: boolean}>} | null}
 */
export function findCardAt(names, maxLength, text, offset) {
  if (offset < 0 || offset >= text.length) return null;
  let best = null;
  for (let start = Math.max(0, offset - maxLength + 1); start <= offset; start++) {
    if (/\s/.test(text[start])) continue;
    if (start > 0 && WORD_CHAR.test(text[start - 1])) continue;
    const maxEnd = Math.min(text.length, start + maxLength);
    for (let end = maxEnd; end > offset && end - start >= MIN_NAME_LENGTH; end--) {
      const candidate = text.slice(start, end);
      if (!names.has(candidate)) continue;
      if (!best || candidate.length > best.name.length) best = { start, end, name: candidate };
      break;
    }
  }
  if (!best) return null;
  const cards = filterByTierHint(names.get(best.name), text.slice(best.end));
  return {
    ...best,
    cards: cards.map(([id, battlegrounds]) => ({ id, battlegrounds: battlegrounds === 1 })),
  };
}
