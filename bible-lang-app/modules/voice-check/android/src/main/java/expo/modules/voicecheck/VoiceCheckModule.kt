package expo.modules.voicecheck

import android.speech.tts.TextToSpeech
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Which languages this phone can really speak offline.
//
// expo-speech's getAvailableVoicesAsync() lists every voice the speech engine knows about,
// including ones it would still have to download (Google's engine lists dozens), so it can't
// tell whether French is installed. Android marks those voices with the "notInstalled" feature,
// and network-only voices with isNetworkConnectionRequired; this module leaves both out.
class VoiceCheckModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VoiceCheck")

    // Resolves to language tags such as ["en-US", "es-ES", "fr-FR"].
    AsyncFunction("installedLanguagesAsync") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("ERR_NO_CONTEXT", "Android context is not available", null)
        return@AsyncFunction
      }
      lateinit var tts: TextToSpeech
      // The engine starts in the background and calls back once it is ready (or failed).
      tts = TextToSpeech(context) { status ->
        try {
          if (status != TextToSpeech.SUCCESS) {
            promise.reject("ERR_TTS_INIT", "The text-to-speech engine did not start", null)
          } else {
            val tags = tts.voices.orEmpty()
              .filter { voice ->
                !voice.features.orEmpty().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) &&
                  !voice.isNetworkConnectionRequired
              }
              .map { it.locale.toLanguageTag() }
              .distinct()
            promise.resolve(tags)
          }
        } catch (err: Exception) {
          promise.reject("ERR_TTS_VOICES", err.message, err)
        } finally {
          tts.shutdown() // this engine instance was only for the check
        }
      }
    }
  }
}
