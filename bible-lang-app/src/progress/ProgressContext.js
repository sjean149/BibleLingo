import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { fetchProgress, saveProgress } from '../api';
import { useAuth } from '../auth/AuthContext';
import { loadState, saveState } from '../storage';
import {
  completeStep as completeStepLogic,
  createInitialState,
  currentStreak,
  dateKey,
  loseHeart as loseHeartLogic,
  mergeProgress,
  msToNextHeart,
  refillHearts,
  progressFingerprint,
  resetProgress as resetProgressLogic,
  syncedProgress,
} from './logic';
import { DEFAULT_LANG, DEMO_MODE, MAX_HEARTS, UNLIMITED_HEARTS } from './rules';
import { setSpeechSpeed } from '../utils/speech';

const ProgressContext = createContext(null);

// Wait this long after a change before uploading, so finishing a step sends one request, not several.
const SYNC_DELAY_MS = 1500;

// A change the learner made: stamp it, so syncing knows which copy's settings are newest.
const touched = (next, prev) => (next === prev ? prev : { ...next, savedAt: Date.now() });

// Holds the saved progress for the whole app. Screens read it with useProgress().
export function ProgressProvider({ children }) {
  const [state, setState] = useState(null); // null until the saved copy has been read
  const [now, setNow] = useState(Date.now());

  // Read the saved progress once, when the app opens.
  useEffect(() => {
    let alive = true;
    loadState().then((saved) => {
      if (!alive) return;
      const t = Date.now();
      const fresh = { ...createInitialState(t), lang: DEFAULT_LANG }; // used only by first-time visitors
      // Unlimited hearts for everyone (UNLIMITED_HEARTS) or in a demo build.
      const demo = DEMO_MODE || UNLIMITED_HEARTS ? { premium: true } : {};
      setState(refillHearts({ ...fresh, ...(saved ?? {}), ...demo }, t));
    });
    return () => {
      alive = false;
    };
  }, []);

  // Save after every change.
  useEffect(() => {
    if (state) saveState(state);
  }, [state]);

  // ---- Sync with the signed-in account (PUT /progress merges this device's copy in).
  const { token, user } = useAuth();
  const userId = user?.id ?? null;
  const stateRef = useRef(state); // the latest state, for the delayed upload
  const syncedRef = useRef(null); // fingerprint of the progress the account last confirmed
  const replaceRef = useRef(false); // next upload replaces the account's copy (after a reset)
  const [syncRound, setSyncRound] = useState(0); // bumped to sync again (app back in front)

  useEffect(() => {
    stateRef.current = state;
  });

  // Coming back to the app: fetch what other devices added meanwhile.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      syncedRef.current = null;
      setSyncRound((n) => n + 1);
    });
    return () => subscription.remove();
  }, []);

  // Signed out, or a different account: the next sign-in starts a fresh round.
  useEffect(() => {
    syncedRef.current = null;
  }, [userId]);

  const fingerprint = state ? progressFingerprint(state) : null;
  const owner = state?.owner ?? null;

  useEffect(() => {
    if (!fingerprint || !token || userId === null) return undefined;
    if (owner === userId && fingerprint === syncedRef.current) return undefined; // nothing new
    let cancelled = false;
    const timer = setTimeout(async () => {
      const local = stateRef.current;
      // Progress left on this device by another account must not join this one: switch to
      // this account's own copy instead. A guest's progress (no owner) joins the account.
      const foreign = local.owner != null && local.owner !== userId;
      const replace = replaceRef.current && !foreign;
      try {
        const reply = foreign
          ? await fetchProgress(token)
          : await saveProgress(token, syncedProgress(local), replace);
        if (cancelled) return;
        if (replace) replaceRef.current = false;
        syncedRef.current = reply.data ? progressFingerprint(reply.data) : null;
        setState((current) => {
          const mine = foreign
            ? { ...resetProgressLogic(current, Date.now()), savedAt: 0, owner: userId }
            : current.owner === userId
              ? current
              : { ...current, owner: userId };
          return mergeProgress(mine, reply.data);
        });
      } catch {
        // offline or the server is down: this device keeps its progress and retries on the next change
      }
    }, SYNC_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fingerprint, token, userId, owner, syncRound]);

  // Every read-aloud voice in the app follows the chosen listening speed.
  const speed = state?.speed ?? 1;
  useEffect(() => {
    setSpeechSpeed(speed);
  }, [speed]);

  // A slow clock: gives back hearts and keeps the countdown fresh while the app is open.
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      setState((s) => (s ? refillHearts(s, t) : s));
    }, 5000);
    return () => clearInterval(id);
  }, []);

  const actions = useMemo(
    () => ({
      setLang: (lang, base) => setState((s) => touched({ ...s, lang, base: base ?? s.base ?? null }, s)),
      loseHeart: () => setState((s) => loseHeartLogic(s, Date.now())),
      completeStep: (lang, chapterId, step) =>
        setState((s) => touched(completeStepLogic(s, lang, chapterId, step, Date.now()), s)),
      setPremium: (premium) => setState((s) => ({ ...s, premium: UNLIMITED_HEARTS || !!premium })),
      setSpeed: (speed) => setState((s) => touched({ ...s, speed }, s)),
      resetProgress: () => {
        replaceRef.current = true; // the account's copy is replaced too, so old steps don't come back
        setState((s) => ({ ...resetProgressLogic(s, Date.now()), owner: s.owner ?? null, savedAt: Date.now() }));
      },
    }),
    []
  );

  const value = useMemo(() => {
    if (!state) return { ready: false };
    const today = dateKey(new Date(now));
    return {
      ready: true,
      state,
      lang: state.lang,
      base: state.lang === 'en' ? (state.base ?? null) : null, // only English uses it
      premium: !!state.premium,
      speed: state.speed ?? 1, // listening speed (older saves have none: normal speed)
      hearts: state.premium ? MAX_HEARTS : state.hearts, // unlimited plan: always full
      msToNextHeart: msToNextHeart(state, now),
      days: state.days,
      today,
      streak: currentStreak(state.days, today),
      practicedToday: state.days.includes(today),
      ...actions,
    };
  }, [state, now, actions]);

  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>;
}

export function useProgress() {
  const value = useContext(ProgressContext);
  if (!value) throw new Error('useProgress must be used inside <ProgressProvider>');
  return value;
}
