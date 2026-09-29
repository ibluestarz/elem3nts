import './Splash.css';

export const SPLASH_TITLE = 'ELEM3NTS';
export const SPLASH_MESSAGE = 'Invocation de l’arène…';

/** Écran d'ouverture minimal (PFC-001), identique à l'état `loading` de la maquette. */
export function Splash() {
  return (
    <main className="splash" aria-labelledby="splash-title">
      <h1 id="splash-title" className="splash__title">
        {SPLASH_TITLE}
      </h1>
      <p className="splash__message" role="status">
        {SPLASH_MESSAGE}
      </p>
    </main>
  );
}
