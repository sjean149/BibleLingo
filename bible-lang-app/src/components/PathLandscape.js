import { memo, useEffect, useState } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { SCENES } from '../art/scenes';
import { colors } from '../theme';

// Native-driver animations don't exist on web; there React Native Web animates in JS instead.
const NATIVE = Platform.OS !== 'web';
const FADE_MS = 450;

// One scene drawn to fill the box. memo: SvgXml parses the whole SVG string on every render,
// so a layer only redraws when its scene changes, not on every scroll event.
// Behind the path the scene's own labels (the map's place names) would collide with the
// milestones, so they are left out here. Built once per scene.
const withoutLabels = {};
const backdropXml = (scene) => {
  if (!(scene in withoutLabels)) withoutLabels[scene] = SCENES[scene]?.replace(/<text[\s\S]*?<\/text>/g, '') ?? null;
  return withoutLabels[scene];
};

const SceneLayer = memo(function SceneLayer({ scene }) {
  const xml = backdropXml(scene);
  return xml ? <SvgXml xml={xml} width="100%" height="100%" preserveAspectRatio="xMidYMax slice" /> : null;
});

// The landscape behind the whole path. It stays still while the road scrolls over it and
// cross-fades to the next setting when the learner scrolls to a chapter that happens elsewhere.
// Only two scenes exist at a time (the one showing and the one fading in), however long the path is.
export default function PathLandscape({ scene }) {
  // shown: the scene fully on screen. A different `scene` prop is the one fading in on top;
  // when its fade finishes it becomes `shown`. (useState, not useRef, so render never reads a ref.)
  const [shown, setShown] = useState(scene);
  const [opacity] = useState(() => new Animated.Value(0));
  const incoming = scene !== shown ? scene : null;

  useEffect(() => {
    if (!incoming) return undefined;
    opacity.setValue(0);
    const fade = Animated.timing(opacity, { toValue: 1, duration: FADE_MS, useNativeDriver: NATIVE });
    fade.start(({ finished }) => {
      if (finished) setShown(incoming); // if a newer scene interrupted, its own fade takes over
    });
    return () => fade.stop();
  }, [incoming, opacity]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <SceneLayer scene={shown} />
      {incoming ? (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
          <SceneLayer scene={incoming} />
        </Animated.View>
      ) : null}
      {/* A light parchment wash keeps the road and the numbers readable over busy scenes. */}
      <View style={[StyleSheet.absoluteFill, styles.wash]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wash: { backgroundColor: colors.parchment, opacity: 0.22 },
});
