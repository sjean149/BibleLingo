// The web build signs in with the browser pop-up (expo-auth-session in AuthContext.js) and never
// loads the native Google sign-in package. These stand-ins are never called on web.
export async function nativeGoogleSignIn() {
  return { type: 'error', message: 'Native Google sign-in is only used on Android' };
}

export async function nativeGoogleSignOut() {}
