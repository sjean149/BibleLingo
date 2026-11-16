import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';

// Google sign-in with Android's own account picker.
//
// Why not the browser pop-up (expo-auth-session) on Android: that returns to the app through a
// custom link scheme (com.sephorajeanmary.biblelingo:/oauthredirect), and Google no longer allows
// custom schemes for Android apps, so it shows "Access blocked".
//
// webClientId is the WEB client id on purpose: it is the audience of the ID token Google returns,
// and the one the backend checks. Google recognises the app itself by its package name and
// signing key's SHA-1, registered on the Android OAuth client in Google Cloud.
//
// Resolves to { type: 'success', idToken } | { type: 'cancel' } | { type: 'error', message }.
export async function nativeGoogleSignIn(webClientId) {
  GoogleSignin.configure({ webClientId });
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return { type: 'cancel' }; // closed the account picker
    const idToken = response.data?.idToken;
    return idToken ? { type: 'success', idToken } : { type: 'error', message: 'Google returned no ID token' };
  } catch (err) {
    if (isErrorWithCode(err)) {
      if (err.code === statusCodes.IN_PROGRESS) return { type: 'cancel' }; // a second tap while open
      if (err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        return { type: 'error', message: 'Google Play services is missing or out of date on this phone' };
      }
    }
    return { type: 'error', message: err?.message || 'Google sign-in failed' };
  }
}

// Forget the chosen account too, so the next sign-in asks which account again.
export async function nativeGoogleSignOut() {
  try {
    await GoogleSignin.signOut();
  } catch {
    // not signed in with Google on this phone: nothing to undo
  }
}
