// Gradient-boosted decision trees, small enough to train in the browser: for a yes/no outcome
// with the log loss, or for a quantity with the squared error.
// Each feature's values are cut into at most `bins` ranges once, and every split is looked
// for over those ranges (the histogram method), so a tree costs rows × features per level.
// Trees grow level by level to maxDepth; each leaf's value is −G/(H+λ) times the learning
// rate, from the gradient G and hessian H of the log loss. Training stops when the loss on
// the held-out rows has not improved for `earlyStop` rounds, and keeps the best round.

export type Dataset = {
  // One array of feature values per row.
  x: number[][]
  // 1 for yes and 0 for no, or the quantity.
  y: number[]
  // How much each row counts.
  w: number[]
}

export type BoostOptions = {
  // binary: yes/no with the log loss (the default). regression: a quantity with the squared error.
  objective?: 'binary' | 'regression'
  rounds: number
  learningRate: number
  maxDepth: number
  // A split must leave at least this many rows on each side.
  minLeafRows: number
  // L2 penalty on leaf values.
  l2: number
  // Share of the features each tree may split on.
  featureFraction: number
  bins: number
  earlyStop: number
  seed: number
}

// A split keeps the gain in log loss it brought, which tells how much each feature counts.
export type TreeNode = { feature: number; threshold: number; left: number; right: number; gain: number } | { value: number }

export type Booster = {
  base: number
  trees: TreeNode[][]
}

export function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value))
}

export function predictMargin(booster: Booster, row: number[]): number {
  let margin = booster.base
  for (const tree of booster.trees) {
    let node = tree[0]
    while (!('value' in node)) node = tree[row[node.feature] <= node.threshold ? node.left : node.right]
    margin += node.value
  }
  return margin
}

export function predictProbability(booster: Booster, row: number[]): number {
  return sigmoid(predictMargin(booster, row))
}

// Cut points per feature: every gap between distinct values when there are few, else the
// values at even quantiles. A value goes to the first range whose cut point it does not pass.
function cutPoints(x: number[][], feature: number, bins: number): number[] {
  const values = [...new Set(x.map((row) => row[feature]))].sort((a, b) => a - b)
  if (values.length <= 1) return []
  if (values.length <= bins) return values.slice(0, -1).map((value, index) => (value + values[index + 1]) / 2)
  const sorted = x.map((row) => row[feature]).sort((a, b) => a - b)
  const cuts: number[] = []
  for (let bin = 1; bin < bins; bin += 1) {
    const value = sorted[Math.floor((bin * sorted.length) / bins)]
    if (cuts.length === 0 || value > cuts[cuts.length - 1]) cuts.push(value)
  }
  return cuts.filter((cut) => cut < values[values.length - 1])
}

function binOf(cuts: number[], value: number): number {
  let low = 0
  let high = cuts.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (value <= cuts[middle]) high = middle
    else low = middle + 1
  }
  return low
}

function seeded(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function logLoss(y: number[], p: number[]): number {
  const clip = (value: number) => Math.min(Math.max(value, 1e-15), 1 - 1e-15)
  return -y.reduce((total, label, index) => total + (label ? Math.log(clip(p[index])) : Math.log(1 - clip(p[index]))), 0) / y.length
}

export function trainBooster(train: Dataset, valid: Dataset | null, options: BoostOptions): Booster {
  const rows = train.x.length
  const featureCount = rows > 0 ? train.x[0].length : 0
  const random = seeded(options.seed)
  const cuts = Array.from({ length: featureCount }, (_, feature) => cutPoints(train.x, feature, options.bins))
  // Binned values, one array per feature.
  const binned = cuts.map((featureCuts, feature) => Uint8Array.from(train.x, (row) => binOf(featureCuts, row[feature])))
  const regression = options.objective === 'regression'
  const totalWeight = train.w.reduce((total, weight) => total + weight, 0)
  const weighted = train.y.reduce((total, label, index) => total + label * train.w[index], 0)
  const mean = regression ? weighted / totalWeight : Math.min(Math.max(weighted / totalWeight, 1e-6), 1 - 1e-6)
  const base = regression ? mean : Math.log(mean / (1 - mean))
  const margins = new Float64Array(rows).fill(base)
  const validMargins = valid ? new Float64Array(valid.x.length).fill(base) : null
  const trees: TreeNode[][] = []
  let best = { loss: Infinity, round: 0 }

  for (let round = 0; round < options.rounds; round += 1) {
    const gradient = new Float64Array(rows)
    const hessian = new Float64Array(rows)
    for (let row = 0; row < rows; row += 1) {
      if (regression) {
        gradient[row] = train.w[row] * (margins[row] - train.y[row])
        hessian[row] = train.w[row]
      } else {
        const p = sigmoid(margins[row])
        gradient[row] = train.w[row] * (p - train.y[row])
        hessian[row] = train.w[row] * Math.max(p * (1 - p), 1e-6)
      }
    }
    const features = Array.from({ length: featureCount }, (_, feature) => feature).filter(
      (feature) => cuts[feature].length > 0 && random() < options.featureFraction,
    )
    const tree = growTree(binned, cuts, features, gradient, hessian, options)
    trees.push(tree)
    for (let row = 0; row < rows; row += 1) margins[row] += leafValue(tree, train.x[row])
    if (valid && validMargins) {
      for (let row = 0; row < valid.x.length; row += 1) validMargins[row] += leafValue(tree, valid.x[row])
      const loss = regression
        ? valid.y.reduce((total, value, index) => total + (validMargins[index] - value) ** 2, 0) / valid.y.length
        : logLoss(valid.y, Array.from(validMargins, sigmoid))
      if (loss < best.loss - 1e-9) best = { loss, round: round + 1 }
      else if (round + 1 - best.round >= options.earlyStop) break
    }
  }
  return { base, trees: valid ? trees.slice(0, Math.max(best.round, 1)) : trees }
}

function leafValue(tree: TreeNode[], row: number[]): number {
  let node = tree[0]
  while (!('value' in node)) node = tree[row[node.feature] <= node.threshold ? node.left : node.right]
  return node.value
}

function growTree(
  binned: Uint8Array[],
  cuts: number[][],
  features: number[],
  gradient: Float64Array,
  hessian: Float64Array,
  options: BoostOptions,
): TreeNode[] {
  const tree: TreeNode[] = []
  const leaf = (members: number[]): TreeNode => {
    let g = 0
    let h = 0
    for (const row of members) {
      g += gradient[row]
      h += hessian[row]
    }
    return { value: (-g / (h + options.l2)) * options.learningRate }
  }
  const grow = (members: number[], depth: number): number => {
    const index = tree.length
    tree.push({ value: 0 })
    const split = depth < options.maxDepth ? bestSplit(binned, cuts, features, gradient, hessian, members, options) : null
    if (!split) {
      tree[index] = leaf(members)
      return index
    }
    const left: number[] = []
    const right: number[] = []
    for (const row of members) (binned[split.feature][row] <= split.bin ? left : right).push(row)
    const leftIndex = grow(left, depth + 1)
    const rightIndex = grow(right, depth + 1)
    tree[index] = { feature: split.feature, threshold: cuts[split.feature][split.bin], left: leftIndex, right: rightIndex, gain: split.gain }
    return index
  }
  grow(Array.from(gradient, (_, row) => row), 0)
  return tree
}

function bestSplit(
  binned: Uint8Array[],
  cuts: number[][],
  features: number[],
  gradient: Float64Array,
  hessian: Float64Array,
  members: number[],
  options: BoostOptions,
): { feature: number; bin: number; gain: number } | null {
  let totalG = 0
  let totalH = 0
  for (const row of members) {
    totalG += gradient[row]
    totalH += hessian[row]
  }
  const score = (g: number, h: number) => (g * g) / (h + options.l2)
  const parent = score(totalG, totalH)
  let best: { feature: number; bin: number; gain: number } | null = null
  for (const feature of features) {
    const binCount = cuts[feature].length + 1
    const g = new Float64Array(binCount)
    const h = new Float64Array(binCount)
    const n = new Int32Array(binCount)
    const column = binned[feature]
    for (const row of members) {
      const bin = column[row]
      g[bin] += gradient[row]
      h[bin] += hessian[row]
      n[bin] += 1
    }
    let leftG = 0
    let leftH = 0
    let leftN = 0
    for (let bin = 0; bin < binCount - 1; bin += 1) {
      leftG += g[bin]
      leftH += h[bin]
      leftN += n[bin]
      const rightN = members.length - leftN
      if (leftN < options.minLeafRows) continue
      if (rightN < options.minLeafRows) break
      const gain = score(leftG, leftH) + score(totalG - leftG, totalH - leftH) - parent
      if (gain > 1e-9 && (!best || gain > best.gain)) best = { feature, bin, gain }
    }
  }
  return best
}
