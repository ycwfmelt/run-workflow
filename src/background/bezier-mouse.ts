export interface Point {
  x: number;
  y: number;
}

export interface MouseTrajectoryOptions {
  steps?: number;
  minDuration?: number; // ms
  maxDuration?: number; // ms
  jitter?: number; // pixels of random deviation
}

// Cubic Bezier interpolation
function cubicBezier(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const oneMinusT = 1 - t;
  return (
    Math.pow(oneMinusT, 3) * p0 +
    3 * Math.pow(oneMinusT, 2) * t * p1 +
    3 * oneMinusT * Math.pow(t, 2) * p2 +
    Math.pow(t, 3) * p3
  );
}

// Ease-in-out timing function (acceleration then deceleration)
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Generate human-like curved mouse trajectory between start and target points
 */
export function generateMouseTrajectory(
  start: Point,
  target: Point,
  options: MouseTrajectoryOptions = {}
): { points: Point[]; delayPerStep: number } {
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Determine realistic number of steps based on distance
  const baseSteps = Math.max(15, Math.min(60, Math.floor(distance / 12)));
  const steps = options.steps ?? baseSteps;

  // Duration scales with distance (200ms to 650ms typical human movement)
  const minDuration = options.minDuration ?? 200;
  const maxDuration = options.maxDuration ?? 600;
  const totalDuration = Math.min(
    maxDuration,
    Math.max(minDuration, distance * 0.8 + 150)
  );
  const delayPerStep = Math.max(8, Math.round(totalDuration / steps));

  // Generate two realistic control points for cubic Bezier
  // Perpendicular deviation from straight line for human hand curve
  const perpX = -dy;
  const perpY = dx;
  const perpDist = Math.sqrt(perpX * perpX + perpY * perpY) || 1;
  const normalizedPerpX = perpX / perpDist;
  const normalizedPerpY = perpY / perpDist;

  // Random curve magnitude
  const curvature1 = (Math.random() - 0.5) * Math.min(distance * 0.35, 120);
  const curvature2 = (Math.random() - 0.5) * Math.min(distance * 0.35, 120);

  const p1: Point = {
    x: start.x + dx * 0.3 + normalizedPerpX * curvature1,
    y: start.y + dy * 0.3 + normalizedPerpY * curvature1,
  };

  const p2: Point = {
    x: start.x + dx * 0.75 + normalizedPerpX * curvature2,
    y: start.y + dy * 0.75 + normalizedPerpY * curvature2,
  };

  const points: Point[] = [];
  const jitterMagnitude = options.jitter ?? 1.5;

  for (let i = 0; i <= steps; i++) {
    const rawT = i / steps;
    const t = easeInOutCubic(rawT);

    let x = cubicBezier(start.x, p1.x, p2.x, target.x, t);
    let y = cubicBezier(start.y, p1.y, p2.y, target.y, t);

    // Add slight physiological jitter during transit, but converge cleanly at destination
    if (i > 0 && i < steps) {
      const currentJitter = jitterMagnitude * (1 - Math.abs(rawT - 0.5));
      x += (Math.random() - 0.5) * currentJitter;
      y += (Math.random() - 0.5) * currentJitter;
    }

    points.push({ x: Math.round(x), y: Math.round(y) });
  }

  return { points, delayPerStep };
}

/**
 * Randomize target point within bounding box to avoid always clicking dead-center
 */
export function getHumanizedClickPoint(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Point {
  // Use a truncated normal distribution around the center
  const u1 = Math.random();
  const u2 = Math.random();
  const randStdNormal = Math.sqrt(-2.0 * Math.log(u1 || 0.001)) * Math.cos(2.0 * Math.PI * u2);

  // Spread within inner 60% of element
  const maxOffsetX = (rect.width * 0.3);
  const maxOffsetY = (rect.height * 0.3);

  const offsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, (randStdNormal * maxOffsetX) / 2));
  const offsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, (randStdNormal * maxOffsetY) / 2));

  return {
    x: Math.round(rect.x + rect.width / 2 + offsetX),
    y: Math.round(rect.y + rect.height / 2 + offsetY),
  };
}

/**
 * Helper delay
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Humanized typing delay between keystrokes (normal distribution around 95ms)
 */
export function getHumanKeystrokeDelay(): number {
  const base = 85;
  const variance = (Math.random() - 0.5) * 50; // 60ms ~ 110ms
  // Occasional slight pause (e.g. thinking or shifting fingers)
  const isPause = Math.random() < 0.08;
  return Math.round(isPause ? base + 180 + Math.random() * 100 : base + variance);
}
