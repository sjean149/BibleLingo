import { requireOptionalNativeModule } from 'expo';

// The native Android module in ./android. null on iPhone, on web, and in any build made
// before this module was added (those keep using expo-speech's voice list instead).
export default requireOptionalNativeModule('VoiceCheck');
