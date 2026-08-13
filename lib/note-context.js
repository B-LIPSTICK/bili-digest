/**
 * 从字幕里挑出「当前播放时刻」对应的句子及其上下文。
 * 纯函数，供后台快捷标记使用，也方便单测。
 */

/**
 * 找覆盖 seconds 的字幕下标；落在两句之间的空隙时取前面那一句。
 */
export function findTargetIndex(segments, seconds) {
  const time = Math.max(0, Number(seconds) || 0);
  let index = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const from = Number(segments[i]?.from) || 0;
    const to = Number(segments[i]?.to) || from;
    if (time >= from) index = i;
    if (time < to) break;
  }
  return index;
}

/**
 * @returns {{before: object[], target: object|null, after: object[], fullContext: object[]}}
 */
export function buildNoteContext(segments, seconds) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return { before: [], target: null, after: [], fullContext: [] };
  }
  const index = findTargetIndex(segments, seconds);
  return {
    before: segments.slice(Math.max(0, index - 2), index),
    target: segments[index] || null,
    after: segments.slice(index + 1, index + 4),
    fullContext: segments.slice(Math.max(0, index - 6), index + 9),
  };
}

/**
 * 把一组字幕拼成纯文本（去掉时间戳），用于填 prompt 或兜底。
 */
export function segmentsToText(segments) {
  return (segments || [])
    .map((segment) => String(segment?.content ?? "").trim())
    .filter(Boolean)
    .join("\n");
}
