import { Linking, Platform } from 'react-native';
import * as Speech from 'expo-speech';
import VoiceCheck from '../../modules/voice-check';

// Lessons read words aloud with the phone's own text-to-speech voices (see ./speech.js). A phone
// without a French or Spanish voice reads those words with the wrong accent or stays silent, and
// an app can't install voices itself, so we check and point the learner to the right settings.

// "fr_FR" (some Android engines) and "fr-FR" both become "fr-fr".
const tagOf = (voice) => (voice.language || '').toLowerCase().replace('_', '-');

const hasLanguage = (voices, lang) => voices.some((v) => tagOf(v) === lang || tagOf(v).startsWith(`${lang}-`));

// 'yes' | 'no' | 'unknown'. Only 'no' means "show a warning": when we can't tell, we stay quiet.
export async function voiceStatus(lang) {
  // Browsers load their voice list lazily and differ a lot; the web build isn't checked.
  if (Platform.OS === 'web') return 'unknown';

  // Android: ask our native module (modules/voice-check), which knows whether a voice is really
  // downloaded. expo-speech's list below also includes voices that still need downloading.
  if (VoiceCheck) {
    try {
      const tags = await VoiceCheck.installedLanguagesAsync();
      return hasLanguage(tags.map((language) => ({ language })), lang) ? 'yes' : 'no';
    } catch {
      return 'unknown';
    }
  }

  // iPhone (which only lists installed voices) and Android builds without the module.
  for (let attempt = 0; attempt < 2; attempt++) {
    let voices;
    try {
      voices = await Speech.getAvailableVoicesAsync();
    } catch {
      return 'unknown';
    }
    if (voices.length > 0) return hasLanguage(voices, lang) ? 'yes' : 'no';
    // An empty list usually means Android's speech engine hasn't started yet: ask once more.
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return 'unknown';
}

// Android screens to try, best first:
//  1. the speech engine's "Install voice data" list (TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA),
//     where the learner taps the language to download it. Android never lets an app install a
//     voice silently, so this is as close as an app can get.
//  2. the system "Text-to-speech output" settings, for engines without that screen.
const INSTALL_SCREENS = ['android.speech.tts.engine.INSTALL_TTS_DATA', 'com.android.settings.TTS_SETTINGS'];

// Opens the place to download a voice. Anywhere those fail (and on iPhone, which has no such
// link), this app's page in Settings.
export async function openVoiceSettings() {
  if (Platform.OS === 'android') {
    for (const action of INSTALL_SCREENS) {
      try {
        await Linking.sendIntent(action);
        return;
      } catch {
        // this phone's engine doesn't offer that screen to other apps: try the next one
      }
    }
  }
  await Linking.openSettings().catch(() => {});
}
