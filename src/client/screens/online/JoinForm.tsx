import { useEffect, useId, useRef, type ClipboardEvent } from 'react';
import { ROOM_CODE_LENGTH } from '../../../shared/protocol/index.ts';
import { codeFromInput, formatCode } from '../../online/invite.ts';

interface JoinFormProps {
  readonly draft: string;
  readonly error: string | null;
  readonly onDraft: (draft: string) => void;
  readonly onSubmit: () => void;
}

/** Saisie du code reçu (maquette `onJoining`) : 8 caractères, séparateur toléré (D39). */
export function JoinForm({ draft, error, onDraft, onSubmit }: JoinFormProps) {
  const inputId = useId();
  const messageId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Un refus ramène le focus dans le champ, texte sélectionné, pour corriger aussitôt.
  useEffect(() => {
    if (error !== null) inputRef.current?.select();
  }, [error]);

  // Lien d'invitation collé : seul son code est gardé (la longueur maximale le tronquerait sinon).
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = codeFromInput(event.clipboardData.getData('text'));
    if (!pasted.ok) return;
    event.preventDefault();
    onDraft(formatCode(pasted.code));
  };

  return (
    <form
      className="join"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label className="panel-label" htmlFor={inputId}>
        Code reçu
      </label>
      <input
        ref={inputRef}
        id={inputId}
        className="join__input"
        type="text"
        value={draft}
        placeholder="ex. K7F2·QX9A"
        maxLength={ROOM_CODE_LENGTH + 1}
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        aria-invalid={error !== null}
        aria-describedby={messageId}
        onChange={(event) => {
          onDraft(event.target.value.toUpperCase());
        }}
        onPaste={onPaste}
      />
      <div className="join__message" id={messageId} role="alert">
        {error}
      </div>
      <button type="submit" className="join__submit">
        Rejoindre
      </button>
    </form>
  );
}
