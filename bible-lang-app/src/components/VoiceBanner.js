import { useEffect, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts } from '../theme';
import { openVoiceSettings, voiceStatus } from '../utils/voices';

const NAMES = { fr: 'French', es: 'Spanish', en: 'English' };

// A notice on the path when the phone has no voice for the language being learned.
// Checks again whenever the app comes back to the front, so it disappears by itself once the
// learner has installed the voice and returned. "Not now" hides it until the app restarts.
export default function VoiceBanner({ lang }) {
  const [result, setResult] = useState(null); // { lang, missing } from the latest check
  const [dismissed, setDismissed] = useState([]); // languages hidden with "Not now"

  useEffect(() => {
    let cancelled = false;
    const check = () =>
      voiceStatus(lang).then((status) => {
        if (!cancelled) setResult({ lang, missing: status === 'no' });
      });
    check();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [lang]);

  // Only trust a result for the language showing now (a check for the previous one may land late).
  if (!result || result.lang !== lang || !result.missing || dismissed.includes(lang)) return null;

  const name = NAMES[lang] ?? lang;
  const android = Platform.OS === 'android';
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Ionicons name="volume-mute" size={22} color={colors.madder} />
      <View style={styles.texts}>
        <Text style={styles.title}>Your phone has no {name} voice</Text>
        <Text style={styles.body}>
          {android
            ? `Lessons read words aloud. Tap Install, choose ${name} in the list, then come back.`
            : `Lessons read words aloud. Add a ${name} voice in Settings > Accessibility > Spoken Content > Voices.`}
        </Text>
        <View style={styles.actions}>
          {android ? (
            <Pressable
              onPress={openVoiceSettings}
              accessibilityRole="button"
              accessibilityLabel={`Install a ${name} voice`}
              style={styles.primary}
            >
              <Text style={styles.primaryText}>Install {name}</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => setDismissed((list) => [...list, lang])}
            accessibilityRole="button"
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.gilt,
    backgroundColor: colors.parchment,
  },
  texts: { flex: 1, gap: 4 },
  title: { fontFamily: fonts.scripture, fontSize: 16, fontWeight: '700', color: colors.inkBrown },
  body: { fontSize: 14, lineHeight: 20, color: colors.inkBrown },
  actions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  primary: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.lapis },
  primaryText: { color: '#FFFFFF', fontWeight: '700' },
  secondary: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1.5, borderColor: colors.line },
  secondaryText: { color: colors.inkBrown, fontWeight: '700' },
});
