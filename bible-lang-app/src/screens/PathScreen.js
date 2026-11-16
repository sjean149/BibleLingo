import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { loadJourney, peekJourney } from '../journeyStore';
import { UNIT_COLORS } from '../unitColors';
import { SCENE_NAMES, sceneForChapter } from '../art/scenes';
import { guideForChapter } from '../art/guides';
import { colors, fonts, radius } from '../theme';
import { computeStatuses, isStepUnlocked, levelProgress, unitProgress } from '../progress/logic';
import { useProgress } from '../progress/ProgressContext';
import Character from '../components/Character';
import LanguagePicker from '../components/LanguagePicker';
import LevelCircle from '../components/LevelCircle';
import PathLandscape from '../components/PathLandscape';
import PathRoad from '../components/PathRoad';
import StepSheet from '../components/StepSheet';
import TopBar from '../components/TopBar';
import VoiceBanner from '../components/VoiceBanner';

// Sideways shift for each chapter in a book, which makes the road wind.
const OFFSETS = [0, 38, 64, 38, 0, -38, -64, -38];

// Every chapter row is the same height, so the road can be drawn from arithmetic instead of
// measuring each milestone. NODE_Y is where the milestone's centre sits inside its row
// (LevelCircle is 106 tall with its 92 px circle at the bottom, centred in a 118 px row).
const ROW_H = 118;
const NODE_Y = 66;
const GUIDE_SIZE = 76;

const offsetFor = (i) => OFFSETS[i % OFFSETS.length];

// How long the book list takes to fade out (React Native's "fade" Modal animation is 300 ms).
const MENU_FADE_MS = 350;

export default function PathScreen({ onStartStep, onOpenStreak, onOpenHearts }) {
  const { state, lang, base, hearts, msToNextHeart } = useProgress();
  const [journey, setJourney] = useState(() => peekJourney(lang, base));
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0); // bump to retry
  const [selected, setSelected] = useState(null); // { unit, level } while the step sheet is open
  const [menuUnit, setMenuUnit] = useState(null); // unit whose title was tapped: the book list is open

  const scrollRef = useRef(null);
  const unitY = useRef({});
  const scrolled = useRef(false);

  useEffect(() => {
    let cancelled = false;
    scrolled.current = false;
    setError(null);
    setJourney(peekJourney(lang, base));
    loadJourney(lang, base)
      .then((data) => {
        if (!cancelled) setJourney(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [lang, base, attempt]);

  // memo: a fresh [] on every render would make everything computed from units recompute too.
  const units = useMemo(() => journey?.units ?? [], [journey]);
  const { statuses } = useMemo(() => computeStatuses(state, lang, units), [state, lang, units]);

  // Width of the scroll area, for drawing the road. Measured with onLayout where that fires;
  // until then (and on web, where it may not) the path is as wide as the window.
  const [measuredWidth, setWidth] = useState(0);
  const window = useWindowDimensions();
  const width = measuredWidth || window.width;
  const [scene, setScene] = useState(null); // setting of the chapter in the middle of the screen
  const rowsOffset = useRef({}); // book order -> y of its first chapter row inside that book's block

  // Where the first chapter row of a book sits in the whole scroll content. Only reads refs,
  // so it never changes.
  const rowsTop = useCallback(
    (order) =>
      unitY.current[order] == null || rowsOffset.current[order] == null
        ? null
        : unitY.current[order] + rowsOffset.current[order],
    []
  );

  // Every chapter in path order with its setting, so the landscape can follow the scroll.
  const chapters = useMemo(
    () =>
      units.flatMap((unit) =>
        unit.levels.map((level, i) => ({
          id: level.chapter_id,
          order: unit.order,
          i,
          scene: sceneForChapter(unit.name, level.chapter_number),
        }))
      ),
    [units]
  );
  const current = chapters.find((c) => statuses[c.id] === 'current');

  // Show the setting of whichever chapter is nearest the middle of the screen. A plain loop over
  // ~260 chapters per scroll event is cheap; setScene with an unchanged value doesn't re-render.
  const onScroll = useCallback(
    (e) => {
      const { contentOffset, layoutMeasurement } = e.nativeEvent;
      const middle = contentOffset.y + layoutMeasurement.height / 2;
      let nearest = null;
      let nearestDistance = Infinity;
      for (const c of chapters) {
        const top = rowsTop(c.order);
        if (top == null) continue;
        const distance = Math.abs(top + c.i * ROW_H + NODE_Y - middle);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = c;
        }
      }
      if (nearest) setScene(nearest.scene);
    },
    [chapters, rowsTop]
  );

  // Jump to the chapter the learner is up to, once, after the layout is known.
  const scrollToCurrent = (unitOrder, rowIndex) => {
    if (scrolled.current) return;
    scrolled.current = true;
    setTimeout(() => {
      const y = (rowsTop(unitOrder) ?? 0) + rowIndex * ROW_H - 180;
      scrollRef.current?.scrollTo({ y: Math.max(0, y), animated: false });
    }, 80);
  };

  // Jump to the top of a book chosen from the list. The scroll waits until the list has finished
  // fading out (MENU_FADE_MS): on web the closing list puts focus back on the banner that opened
  // it, and that focus would otherwise drag the path straight back to where it was.
  const jumpToUnit = (unit) => {
    setMenuUnit(null);
    setTimeout(() => {
      const y = unitY.current[unit.order] ?? 0;
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: false });
    }, MENU_FADE_MS);
  };

  const sheetLevel = selected?.level;
  const sheetProgress = sheetLevel ? levelProgress(state, lang, sheetLevel) : { available: [], done: [] };
  const sheetColor = selected ? UNIT_COLORS[(selected.unit.order - 40) % UNIT_COLORS.length] : colors.lapis;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <TopBar onOpenStreak={onOpenStreak} onOpenHearts={onOpenHearts} />
      <VoiceBanner lang={lang} />

      {error && !journey ? (
        <View style={styles.center}>
          <Text style={styles.message}>Can't reach the server: {error}</Text>
          <Pressable onPress={() => setAttempt((n) => n + 1)} style={styles.retry} accessibilityRole="button">
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : !journey ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.lapis} />
        </View>
      ) : (
        <View style={styles.journey} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          <PathLandscape scene={scene ?? current?.scene ?? 'map'} />
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.scroll}
            onScroll={onScroll}
            scrollEventThrottle={32}
          >
            {units.map((unit, unitIndex) => {
              const color = UNIT_COLORS[unitIndex % UNIT_COLORS.length];
              const progress = unitProgress(state, lang, unit);
              const empty = unit.levels.length === 0;
              // Milestone centres for the road, in the coordinates of this book's block of rows.
              const points = unit.levels.map((_, i) => ({ x: width / 2 + offsetFor(i), y: i * ROW_H + NODE_Y }));
              return (
                <View key={unit.name} onLayout={(e) => (unitY.current[unit.order] = e.nativeEvent.layout.y)}>
                  <Pressable
                    onPress={() => setMenuUnit(unit)}
                    accessibilityRole="button"
                    accessibilityLabel={`${unit.display_name}. Choose a book`}
                    style={styles.banner}
                  >
                    <View style={[styles.bannerMark, { backgroundColor: empty ? colors.line : color }]} />
                    <View style={styles.bannerText}>
                      <Text style={styles.unitLabel}>Book {unitIndex + 1}</Text>
                      <Text style={[styles.unitTitle, empty && { color: colors.muted }]}>{unit.display_name}</Text>
                    </View>
                    <Text style={styles.unitCount}>{empty ? '' : `${progress.done}/${progress.total}`}</Text>
                    <Ionicons name="chevron-down" size={22} color={colors.sepia} style={styles.chevron} />
                  </Pressable>

                  {empty ? (
                    <Text style={styles.soon}>Coming soon. This book hasn't been added yet.</Text>
                  ) : (
                    <View
                      style={{ height: unit.levels.length * ROW_H }}
                      onLayout={(e) => (rowsOffset.current[unit.order] = e.nativeEvent.layout.y)}
                    >
                      <PathRoad points={points} width={width} height={unit.levels.length * ROW_H} />
                      {unit.levels.map((level, i) => {
                        const status = statuses[level.chapter_id] ?? 'locked';
                        const p = levelProgress(state, lang, level);
                        const offset = offsetFor(i);
                        return (
                          <View
                            key={level.chapter_id}
                            style={[styles.levelRow, { transform: [{ translateX: offset }] }]}
                            onLayout={status === 'current' ? () => scrollToCurrent(unit.order, i) : undefined}
                          >
                            {status === 'current' ? (
                              <Guide
                                unit={unit}
                                level={level}
                                offset={offset}
                                width={width}
                              />
                            ) : null}
                            <LevelCircle
                              number={level.chapter_number}
                              status={status}
                              available={p.available}
                              done={p.done}
                              color={color}
                              onPress={() => setSelected({ unit, level })}
                            />
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}

      <Modal visible={!!menuUnit} transparent animationType="fade" onRequestClose={() => setMenuUnit(null)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuUnit(null)} accessibilityLabel="Close book list">
          <Pressable style={styles.menu} onPress={() => {}}>
            <Text style={styles.menuTitle}>Jump to a book</Text>
            <ScrollView>
              {units.map((unit, i) => {
                const empty = unit.levels.length === 0;
                const p = unitProgress(state, lang, unit);
                const isCurrent = menuUnit && menuUnit.order === unit.order;
                return (
                  <Pressable
                    key={unit.name}
                    onPress={() => jumpToUnit(unit)}
                    accessibilityRole="button"
                    style={[styles.menuItem, isCurrent && styles.menuItemOn]}
                  >
                    <View style={[styles.dot, { backgroundColor: empty ? colors.line : UNIT_COLORS[i % UNIT_COLORS.length] }]} />
                    <Text style={[styles.menuName, empty && { color: colors.muted }]} numberOfLines={1}>
                      {i + 1}. {unit.display_name}
                    </Text>
                    <Text style={styles.menuCount}>{empty ? 'Soon' : `${p.done}/${p.total}`}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Saved progress from before English asked which language the learner speaks. */}
      <LanguagePicker visible={lang === 'en' && !base} askSpoken onClose={() => {}} />

      <StepSheet
        visible={!!selected}
        title={selected ? `${selected.unit.display_name} ${selected.level.chapter_number}` : ''}
        lang={lang}
        scene={selected ? sceneForChapter(selected.unit.name, selected.level.chapter_number) : null}
        color={sheetColor}
        available={sheetProgress.available}
        done={sheetProgress.done}
        isUnlocked={(step) => (selected ? isStepUnlocked(state, lang, selected.level, step) : false)}
        hearts={hearts}
        msToNextHeart={msToNextHeart}
        onOpenHearts={() => {
          setSelected(null);
          onOpenHearts();
        }}
        onClose={() => setSelected(null)}
        onStart={(step) => {
          const { unit, level } = selected;
          setSelected(null);
          onStartStep({ unit, level, step });
        }}
      />
    </SafeAreaView>
  );
}

// The helper for the chapter the learner is up to, standing beside the road with the name of the
// place the chapter happens. It stands on the side of the road with more room, about 112 px from
// the milestone, and never past the screen's edge.
function Guide({ unit, level, offset, width }) {
  const scene = sceneForChapter(unit.name, level.chapter_number);
  const guide = guideForChapter(unit.order, level.chapter_number, scene);
  const place = scene === 'map' ? null : SCENE_NAMES[scene];
  const half = GUIDE_BOX / 2;
  const side = offset > 0 ? -1 : 1;
  const centerX = Math.min(width - half, Math.max(half, width / 2 + offset + side * 112));
  // The row this sits in is already shifted sideways by `offset`; undo that.
  const left = centerX - half - offset;
  return (
    <View style={[styles.guide, { left }]} pointerEvents="none">
      <Character name={guide} size={GUIDE_SIZE} />
      {place ? (
        <View style={styles.place}>
          <Text style={styles.placeText} numberOfLines={1}>
            {place}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const GUIDE_BOX = 124;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.mist },
  journey: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  message: { fontSize: 16, color: colors.muted, textAlign: 'center' },
  retry: { paddingVertical: 10, paddingHorizontal: 22, borderRadius: radius.button, backgroundColor: colors.lapis },
  retryText: { color: '#FFFFFF', fontWeight: '700' },
  scroll: { paddingBottom: 80 },
  // Book titles: a parchment label with a gilt edge and the book's colour as a ribbon mark.
  banner: {
    marginHorizontal: 16,
    marginTop: 24,
    marginBottom: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.gilt,
    backgroundColor: colors.parchment,
    flexDirection: 'row',
    alignItems: 'center',
  },
  bannerMark: { width: 8, height: 40, borderRadius: 4, marginRight: 12 },
  bannerText: { flex: 1 },
  unitLabel: { fontFamily: fonts.scripture, fontSize: 13, fontStyle: 'italic', color: colors.sepia },
  unitTitle: { fontFamily: fonts.scripture, fontSize: 22, fontWeight: '700', color: colors.inkBrown },
  unitCount: { fontSize: 16, fontWeight: '800', color: colors.sepia },
  chevron: { marginLeft: 8 },
  guide: { position: 'absolute', top: 12, width: GUIDE_BOX, alignItems: 'center' },
  place: {
    marginTop: -6,
    maxWidth: GUIDE_BOX,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.gilt,
    backgroundColor: colors.parchment,
  },
  placeText: { fontFamily: fonts.scripture, fontSize: 11, color: colors.inkBrown },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', paddingHorizontal: 16, paddingTop: 90, paddingBottom: 40 },
  menu: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingVertical: 8,
    maxHeight: '75%',
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  menuTitle: { fontSize: 13, fontWeight: '800', letterSpacing: 1, color: colors.muted, paddingHorizontal: 18, paddingVertical: 10 },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 18, gap: 12 },
  menuItemOn: { backgroundColor: colors.lapisTint },
  dot: { width: 14, height: 14, borderRadius: 7 },
  menuName: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.ink },
  menuCount: { fontSize: 14, fontWeight: '700', color: colors.muted },
  levelRow: { height: ROW_H, alignItems: 'center', justifyContent: 'center' },
  soon: { textAlign: 'center', color: colors.inkBrown, padding: 20 },
});
