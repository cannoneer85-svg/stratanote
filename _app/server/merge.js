// Helper to calculate line-by-line LCS Diff
export function diffLines(oldLines, newLines) {
  const m = oldLines.length;
  const n = newLines.length;
  
  // dp[i][j] stores the length of LCS of oldLines[0..i-1] and newLines[0..j-1]
  const dp = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const result = [];
  let i = m, j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: 'unchanged', text: oldLines[i - 1], oldIdx: i - 1, newIdx: j - 1 });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'added', text: newLines[j - 1], newIdx: j - 1 });
      j--;
    } else {
      result.unshift({ type: 'removed', text: oldLines[i - 1], oldIdx: i - 1 });
      i--;
    }
  }

  return result;
}

// Convert diff result to Hunks (coalesced blocks of modifications)
export function getHunks(baseLines, targetLines) {
  const diff = diffLines(baseLines, targetLines);
  const hunks = [];
  
  let i = 0;
  while (i < diff.length) {
    if (diff[i].type === 'unchanged') {
      i++;
      continue;
    }
    
    let baseStart = null;
    let baseEnd = null;
    const newLines = [];
    
    while (i < diff.length && diff[i].type !== 'unchanged') {
      const item = diff[i];
      if (item.type === 'removed') {
        if (baseStart === null) baseStart = item.oldIdx;
        baseEnd = item.oldIdx;
      } else if (item.type === 'added') {
        newLines.push(item.text);
      }
      i++;
    }
    
    // For pure additions (where no lines are removed)
    if (baseStart === null) {
      let prevUnchangedIdx = -1;
      // Go back to find the nearest preceding unchanged line
      for (let k = i - newLines.length - 1; k >= 0; k--) {
        if (diff[k].type === 'unchanged') {
          prevUnchangedIdx = diff[k].oldIdx;
          break;
        }
      }
      baseStart = prevUnchangedIdx + 1;
      baseEnd = prevUnchangedIdx; // empty interval indicating insertion
    }
    
    hunks.push({
      baseStart,
      baseEnd,
      newLines
    });
  }
  return hunks;
}

// Perform 3-way merge
// base: original text
// ours: current text on disk (modified by someone else)
// theirs: suggested changes from reviewer
export function threeWayMerge(base, ours, theirs) {
  const baseLines = base.split('\n');
  const oursLines = ours.split('\n');
  const theirsLines = theirs.split('\n');

  const hunksOurs = getHunks(baseLines, oursLines).map(h => ({ ...h, source: 'ours' }));
  const hunksTheirs = getHunks(baseLines, theirsLines).map(h => ({ ...h, source: 'theirs' }));

  // Combine and sort hunks by baseStart
  const allHunks = [...hunksOurs, ...hunksTheirs].sort((a, b) => {
    if (a.baseStart !== b.baseStart) {
      return a.baseStart - b.baseStart;
    }
    // If they start at the same line, place the insertion (empty interval) first
    const aLen = a.baseEnd - a.baseStart;
    const bLen = b.baseEnd - b.baseStart;
    return aLen - bLen;
  });

  const mergedLines = [];
  let currentBaseIdx = 0;
  let hasConflict = false;

  let i = 0;
  while (i < allHunks.length) {
    const hunk = allHunks[i];

    // If hunk starts after current index, copy unchanged lines from base
    if (hunk.baseStart > currentBaseIdx) {
      mergedLines.push(...baseLines.slice(currentBaseIdx, hunk.baseStart));
      currentBaseIdx = hunk.baseStart;
    }

    // Check if this hunk overlaps with the next hunk
    let overlapGroup = [hunk];
    let maxBaseEnd = hunk.baseEnd;

    while (i + 1 < allHunks.length) {
      const nextHunk = allHunks[i + 1];
      const isOverlap = nextHunk.baseStart <= maxBaseEnd || 
                        (nextHunk.baseStart === hunk.baseStart && nextHunk.baseEnd === hunk.baseEnd && hunk.baseEnd === hunk.baseStart - 1);
      
      if (isOverlap) {
        overlapGroup.push(nextHunk);
        maxBaseEnd = Math.max(maxBaseEnd, nextHunk.baseEnd);
        i++;
      } else {
        break;
      }
    }

    if (overlapGroup.length === 1) {
      // No overlap: apply the change cleanly
      // Skip if the hunk was already covered by a previous merged group
      if (hunk.baseStart >= currentBaseIdx) {
        mergedLines.push(...hunk.newLines);
        currentBaseIdx = Math.max(currentBaseIdx, hunk.baseEnd + 1);
      }
    } else {
      // Overlap detected: check if they are actually conflicting
      const oursGroup = overlapGroup.filter(h => h.source === 'ours');
      const theirsGroup = overlapGroup.filter(h => h.source === 'theirs');

      // Reconstruct what ours and theirs proposed for this range [hunk.baseStart, maxBaseEnd]
      const rangeStart = hunk.baseStart;
      const rangeEnd = maxBaseEnd;

      // Original lines in this range
      const baseSub = baseLines.slice(rangeStart, rangeEnd + 1);

      // Apply ours changes to baseSub
      const oursSub = applyHunksToSubrange(baseSub, rangeStart, rangeEnd, oursGroup);
      // Apply theirs changes to baseSub
      const theirsSub = applyHunksToSubrange(baseSub, rangeStart, rangeEnd, theirsGroup);

      if (oursSub.join('\n') === theirsSub.join('\n')) {
        // Both sides made the exact same change, no conflict
        mergedLines.push(...oursSub);
      } else {
        // Real conflict!
        hasConflict = true;
        mergedLines.push('<<<<<<< Текущая версия (на диске)');
        mergedLines.push(...oursSub);
        mergedLines.push('=======');
        mergedLines.push(...theirsSub);
        mergedLines.push('>>>>>>> Предложенная версия');
      }
      currentBaseIdx = rangeEnd + 1;
    }
    i++;
  }

  // Push remaining base lines
  if (currentBaseIdx < baseLines.length) {
    mergedLines.push(...baseLines.slice(currentBaseIdx));
  }

  return {
    mergedText: mergedLines.join('\n'),
    hasConflict
  };
}

// Helper to apply a group of hunks to a specific range of base lines
function applyHunksToSubrange(baseSubLines, rangeStart, rangeEnd, hunks) {
  if (hunks.length === 0) {
    return baseSubLines;
  }
  const result = [];
  let curr = rangeStart;

  for (const h of hunks) {
    if (h.baseStart > curr) {
      result.push(...baseSubLines.slice(curr - rangeStart, h.baseStart - rangeStart));
      curr = h.baseStart;
    }
    result.push(...h.newLines);
    curr = Math.max(curr, h.baseEnd + 1);
  }

  if (curr <= rangeEnd) {
    result.push(...baseSubLines.slice(curr - rangeStart));
  }
  return result;
}
