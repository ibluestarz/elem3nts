import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ELEMENTS, type Element, type PlayerIndex } from '../domain/index.ts';
import { ToastProvider } from './components/Toast.tsx';
import { useToast } from './components/toastContext.ts';
import { useCompact } from './hooks/useCompact.ts';
import { layoutLabels, useLayoutState } from './hooks/useLayoutLabels.ts';
import { keyLabel, type KeySlot } from './input/keys.ts';
import { isEditableTarget, ownsKey, useLocalKeys } from './input/useLocalKeys.ts';
import { Arena } from './screens/Arena.tsx';
import { EndScreen } from './screens/EndScreen.tsx';
import { localEndProps } from './screens/arenaModel.ts';
import { useScene, type FallbackReason } from './scene/sceneContext.ts';
import { sceneViewOf, useSceneBridge } from './scene/useSceneBridge.ts';
import { HomeScreen, type HomeAction } from './screens/HomeScreen.tsx';
import { OnlineScreen } from './screens/OnlineScreen.tsx';
import { codeFromPath } from './online/invite.ts';
import { clearSession, loadSession } from './online/session.ts';
import { RulesDialog } from './screens/RulesDialog.tsx';
import { SettingsDrawer } from './screens/SettingsDrawer.tsx';
import { SetupScreen } from './screens/SetupScreen.tsx';
import { now } from './state/clock.ts';
import { draftInput, gameReducer, initialGameState, isMatchInProgress } from './state/game.ts';
import { updatePreferences, usePreferences } from './state/preferences.ts';
import { useCycle } from './state/useCycle.ts';
import './Stage.css';

type Screen = 'home' | 'setup' | 'rules' | 'settings' | 'arena' | 'online';

const SOON: Readonly<Partial<Record<HomeAction, string>>> = {
  demo: 'La démo des confrontations arrive bientôt.',
  notes: 'Les notes de conception arrivent bientôt.',
};

const FALLBACK_MESSAGES: Readonly<Record<FallbackReason, string>> = {
  unsupported: 'Scène 3D indisponible sur cet appareil : la partie se joue sans effets.',
  failed: 'Scène 3D non chargée : la partie se joue sans effets.',
  lost: 'Scène 3D interrompue : la partie continue sans effets.',
  slow: 'Scène 3D trop lente sur cet appareil : la partie se joue sans effets.',
};

/** Scène de l'application chargée après l'écran d'ouverture : écrans, navigation et raccourcis. */
export default function Stage() {
  return (
    <ToastProvider>
      <StageScreens />
    </ToastProvider>
  );
}

function StageScreens() {
  const rootRef = useRef<HTMLElement>(null);
  const compact = useCompact(rootRef);
  const layoutState = useLayoutState();
  const layout = layoutLabels(layoutState);
  const preferences = usePreferences();
  const toast = useToast();
  const [game, dispatch] = useReducer(gameReducer, undefined, initialGameState);
  // Invitation ouverte (`/p/CODE`, D39) : le mode en ligne s'ouvre sur « Rejoindre », code prérempli.
  const [invite] = useState(() => inviteFromLocation());
  const [invitedCode, setInvitedCode] = useState(invite.code);
  // Place gardée par l'onglet (rechargement pendant une room, PFC-017) : le mode en ligne la reprend
  // aussitôt. Une invitation ouverte l'emporte : l'onglet part vers une autre room.
  const [resume, setResume] = useState(() => (invite.path ? null : loadSession()));
  const [screen, setScreen] = useState<Screen>(invite.code === null && resume === null ? 'home' : 'online');
  const [settingsReturn, setSettingsReturn] = useState<'home' | 'setup'>('home');
  const [homeFocus, setHomeFocus] = useState<HomeAction | null>(null);
  const [focusInput, setFocusInput] = useState(0);
  /** Retour des réglages vers la préparation : focus rendu à « Modifier les touches » (PFC-021). */
  const [setupFocus, setSetupFocus] = useState<'title' | 'keys'>('title');

  const scene = useScene();
  const sceneOptions = { quality: preferences.quality, reducedMotion: preferences.reducedMotion, compact };
  const sceneView = useMemo(() => sceneViewOf(screen === 'online' ? 'home' : screen, game), [screen, game]);
  // Le mode en ligne pilote lui-même la scène (lobby puis partie, `OnlineScreen`) : un seul pont actif.
  useSceneBridge(screen === 'online' ? null : scene.engine, sceneView, sceneOptions);

  // Repli sans 3D : annoncé une seule fois, avec sa cause (D33).
  const fallbackAnnounced = useRef(false);
  useEffect(() => {
    if (scene.reason === null || fallbackAnnounced.current) return;
    fallbackAnnounced.current = true;
    toast.show(FALLBACK_MESSAGES[scene.reason]);
  }, [scene.reason, toast]);

  // L'adresse d'invitation est retirée de la barre : un rechargement ne rejoint pas une seconde fois.
  useEffect(() => {
    if (!invite.path) return;
    clearSession();
    window.history.replaceState(window.history.state, '', '/');
    if (invite.code === null) toast.show('Lien d’invitation invalide : demandez un nouveau lien à votre adversaire.');
  }, [invite, toast]);

  const input = draftInput(game);
  const error = input.ok ? null : input.error;

  useEffect(() => {
    document.documentElement.dataset['reducedMotion'] = String(preferences.reducedMotion);
  }, [preferences.reducedMotion]);

  const keyLabels = useMemo(
    () =>
      preferences.bindings.map((keys) =>
        Object.fromEntries(ELEMENTS.map((element) => [element, keyLabel(keys[element], layout, preferences.learnedLabels, preferences.displayLayout)])),
      ) as unknown as readonly [Record<string, string>, Record<string, string>],
    [preferences.bindings, preferences.learnedLabels, preferences.displayLayout, layout],
  );

  const goHome = useCallback((focus: HomeAction | null) => {
    setHomeFocus(focus);
    setScreen('home');
  }, []);

  const openSettings = useCallback((from: 'home' | 'setup') => {
    setSettingsReturn(from);
    setScreen('settings');
  }, []);

  const start = useCallback(() => {
    if (!input.ok) {
      setFocusInput((count) => count + 1);
      return;
    }
    dispatch({ type: 'start', drawEnabled: preferences.drawEnabled, now: now() });
    setScreen('arena');
  }, [input.ok, preferences.drawEnabled]);

  // Quitter : annule une partie en cours (aucun trophée) ; après la fin, simple retour à l'accueil.
  const matchInProgress = isMatchInProgress(game);
  const quit = useCallback(() => {
    dispatch({ type: 'quit' });
    if (matchInProgress) toast.show('Partie annulée : aucun trophée attribué.');
    goHome('local');
  }, [goHome, toast, matchInProgress]);

  // Revanche (D12) : mêmes réglages, nouveau matchId, trophées conservés ; ignorée hors fin de partie.
  const replay = useCallback(() => {
    dispatch({ type: 'rematch', now: now() });
  }, []);

  // Horloge du cycle (D31) ; sur un seul téléphone, chaque manche s'ouvre en tour par tour (PFC-025, D47).
  useCycle(game.deadline, compact, dispatch);

  // Sélection ouverte, pour n'annuler que les frappes traitées ; le reducer reste l'autorité.
  const accepting = useRef(false);
  useLayoutEffect(() => {
    accepting.current = game.phase === 'selecting';
  }, [game.phase]);

  const choose = useCallback((slot: KeySlot) => {
    dispatch({ type: 'choose', player: slot.player, element: slot.element, now: now() });
  }, []);

  // Tour par tour : choix au toucher du joueur dont c'est le tour, et « Je suis prêt » du voile.
  const chooseTurn = useCallback((player: PlayerIndex, element: Element) => {
    dispatch({ type: 'choose', player, element, now: now() });
  }, []);
  const turnReady = useCallback(() => {
    dispatch({ type: 'turn-ready', now: now() });
  }, []);

  const learn = useCallback(
    (code: string, label: string) => {
      if (preferences.learnedLabels[code] !== label) {
        updatePreferences({ learnedLabels: { ...preferences.learnedLabels, [code]: label } });
      }
    },
    [preferences.learnedLabels],
  );

  useLocalKeys({
    // Clavier partagé : manches simultanées seulement (en tour par tour, le toucher choisit, D47).
    enabled: screen === 'arena' && game.turn === null && game.phase !== 'ended',
    accepting,
    bindings: preferences.bindings,
    onChoose: choose,
    onLearn: learn,
  });

  const onHome = useCallback(
    (action: HomeAction) => {
      const soon = SOON[action];
      if (soon !== undefined) {
        toast.show(soon);
        return;
      }
      if (action === 'local') {
        // Entrer en mode local ouvre une nouvelle session : trophées à 0/0 (D13).
        dispatch({ type: 'new-session' });
        setSetupFocus('title');
        setScreen('setup');
      }
      else if (action === 'online') setScreen('online');
      else if (action === 'rules') setScreen('rules');
      else openSettings('home');
    },
    [openSettings, toast],
  );

  const closeSettings = useCallback(() => {
    if (settingsReturn === 'setup') {
      setSetupFocus('keys');
      setScreen('setup');
    } else goHome('settings');
  }, [goHome, settingsReturn]);

  const ended = game.phase === 'ended';

  // Raccourcis contextuels de la maquette : Espace (accueil → préparation → partie → revanche) et Échap (retour).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const isSpace = event.code === 'Space' || event.key === ' ';
      if (isSpace) {
        // Un bouton ciblé garde son action native : pas de double déclenchement (SPEC saisie).
        if (ownsKey(event.target)) return;
        if (screen === 'home') {
          event.preventDefault();
          // Même action que « Jouer en local » : nouvelle session (D13), au clavier comme au pointeur.
          onHome('local');
        } else if (screen === 'setup') {
          event.preventDefault();
          start();
        } else if (screen === 'arena' && ended) {
          event.preventDefault();
          replay();
        }
        return;
      }
      if (event.key !== 'Escape') return;
      if (isEditableTarget(event.target)) return;
      if (screen === 'arena') quit();
      else if (screen === 'settings') closeSettings();
      else if (screen === 'rules') goHome('rules');
      else if (screen === 'setup') goHome('local');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [screen, ended, start, quit, replay, closeSettings, goHome, onHome]);

  return (
    <main className="stage" ref={rootRef} aria-labelledby="screen-title">
      {screen === 'home' && <HomeScreen compact={compact} onAction={onHome} returnFocus={homeFocus} />}
      {screen === 'setup' && (
        <SetupScreen
          compact={compact}
          target={game.target}
          draft={game.draft}
          error={error}
          keyLabels={keyLabels}
          focusInput={focusInput}
          onDraft={(text) => {
            dispatch({ type: 'draft', text });
          }}
          onTarget={(value) => {
            dispatch({ type: 'target', value });
          }}
          onStep={(delta) => {
            dispatch({ type: 'step', delta });
          }}
          onBack={() => {
            goHome('local');
          }}
          onEditKeys={() => {
            openSettings('setup');
          }}
          onStart={start}
          initialFocus={setupFocus}
        />
      )}
      {screen === 'online' && (
        <OnlineScreen
          compact={compact}
          invitedCode={invitedCode}
          resume={resume}
          preferredDraw={preferences.drawEnabled}
          keyLabels={keyLabels[0]}
          bindings={preferences.bindings}
          sceneOptions={sceneOptions}
          onLearn={learn}
          onExit={() => {
            // L'invitation ne préremplit la saisie qu'une fois ; la place reprise ne l'est qu'une fois.
            setInvitedCode(null);
            setResume(null);
            goHome('online');
          }}
        />
      )}
      {screen === 'rules' && (
        <RulesDialog
          onClose={() => {
            goHome('rules');
          }}
          onNotes={() => {
            toast.show(SOON.notes ?? '');
          }}
        />
      )}
      {screen === 'settings' && (
        <SettingsDrawer layout={layout} layoutUnavailable={layoutState === 'unavailable'} onClose={closeSettings} />
      )}
      {screen === 'arena' &&
        game.match &&
        (ended ? (
          <EndScreen compact={compact} {...localEndProps(game.match, game.session.trophies)} onReplay={replay} onHome={quit} />
        ) : (
          <Arena compact={compact} game={game} keyLabels={keyLabels} onQuit={quit} onChoose={chooseTurn} onTurnReady={turnReady} />
        ))}
    </main>
  );
}

/** Chemin d'invitation au chargement : `path` s'il en a la forme, `code` s'il est valide. */
function inviteFromLocation(): { readonly path: boolean; readonly code: string | null } {
  const { pathname } = window.location;
  return { path: pathname.startsWith('/p/'), code: codeFromPath(pathname) };
}
