import { memo } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../theme';

// The road that winds through one book's chapters, drawn behind its milestones.
// points: the centre of each milestone, top to bottom, in this box's own coordinates.
// Each bend is a cubic curve whose handles point straight down then straight up, so the road
// leaves one stone heading down and arrives at the next from above, like a footpath.
export function roadPath(points) {
  if (points.length === 0) return '';
  let d = `M${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const bend = (b.y - a.y) / 2;
    d += ` C${a.x} ${a.y + bend} ${b.x} ${b.y - bend} ${b.x} ${b.y}`;
  }
  return d;
}

export default memo(function PathRoad({ points, width, height }) {
  if (!width || points.length < 2) return null;
  const d = roadPath(points);
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Path d={d} stroke={colors.roadEdge} strokeWidth={22} strokeLinecap="round" fill="none" opacity={0.55} />
      <Path d={d} stroke={colors.road} strokeWidth={17} strokeLinecap="round" fill="none" />
      <Path d={d} stroke={colors.roadEdge} strokeWidth={2} strokeDasharray="3 9" strokeLinecap="round" fill="none" />
    </Svg>
  );
});
