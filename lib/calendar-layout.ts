/**
 * Column layout for overlapping time blocks (the algorithm FullCalendar and
 * react-big-calendar's "no-overlap" mode use):
 *
 * 1. sort by start (longer first on ties);
 * 2. walk the list keeping the running max end; when the next block starts at
 *    or after that, a new CLUSTER begins (blocks in different clusters never
 *    touch);
 * 3. inside a cluster assign each block the first column whose last block has
 *    ended;
 * 4. every block in a cluster is divided by the cluster's column count, so two
 *    blocks that overlap in time can never overlap in x.
 */
export interface TimeBlock {
  id: string;
  startMin: number;
  endMin: number;
}

export interface BlockPlacement {
  col: number;
  totalCols: number;
}

export function layoutTimeBlocks(blocks: TimeBlock[]): Map<string, BlockPlacement> {
  const out = new Map<string, BlockPlacement>();
  const sorted = [...blocks].sort(
    (a, b) => a.startMin - b.startMin || (b.endMin - b.startMin) - (a.endMin - a.startMin) || a.id.localeCompare(b.id),
  );

  let cluster: TimeBlock[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (cluster.length === 0) return;
    const colEnds: number[] = [];
    const cols = new Map<string, number>();
    for (const b of cluster) {
      let c = colEnds.findIndex((end) => end <= b.startMin);
      if (c === -1) { c = colEnds.length; colEnds.push(b.endMin); }
      else colEnds[c] = b.endMin;
      cols.set(b.id, c);
    }
    for (const b of cluster) out.set(b.id, { col: cols.get(b.id)!, totalCols: colEnds.length });
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const b of sorted) {
    if (cluster.length > 0 && b.startMin >= clusterEnd) flush();
    cluster.push(b);
    clusterEnd = Math.max(clusterEnd, b.endMin);
  }
  flush();
  return out;
}

/** True when any two placed blocks overlap in both time and column. Test helper. */
export function hasVisualCollision(blocks: TimeBlock[], placement: Map<string, BlockPlacement>): boolean {
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i], b = blocks[j];
      const timeOverlap = a.startMin < b.endMin && b.startMin < a.endMin;
      if (!timeOverlap) continue;
      const pa = placement.get(a.id)!, pb = placement.get(b.id)!;
      const aL = pa.col / pa.totalCols, aR = (pa.col + 1) / pa.totalCols;
      const bL = pb.col / pb.totalCols, bR = (pb.col + 1) / pb.totalCols;
      if (aL < bR && bL < aR) return true;
    }
  }
  return false;
}
