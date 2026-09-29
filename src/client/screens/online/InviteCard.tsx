import { useEffect, useId, useRef, useState } from 'react';
import { copyText } from '../../online/clipboard.ts';
import { formatCode, inviteLink } from '../../online/invite.ts';
import { COPY_FAILED, LINK_COPIED } from '../../online/messages.ts';

/** Durée du libellé « Lien copié » avant de proposer une nouvelle copie. */
export const COPIED_MS = 2500;

type CopyState = 'idle' | 'copied' | 'failed';

interface InviteCardProps {
  readonly code: string;
}

/**
 * Code de la partie (maquette `onHosting`) et copie du lien d'invitation, qui ne contient que le
 * code (D39). Presse-papier indisponible ou refusé : le lien s'affiche, sélectionné, pour une copie manuelle.
 */
export function InviteCard({ code }: InviteCardProps) {
  const [copy, setCopy] = useState<CopyState>('idle');
  const fieldRef = useRef<HTMLInputElement>(null);
  const messageId = useId();
  const link = inviteLink(code);

  useEffect(() => {
    if (copy === 'copied') {
      const timer = window.setTimeout(() => {
        setCopy('idle');
      }, COPIED_MS);
      return () => {
        window.clearTimeout(timer);
      };
    }
    if (copy === 'failed') fieldRef.current?.select();
    return undefined;
  }, [copy]);

  const onCopy = () => {
    void copyText(link).then((copied) => {
      setCopy(copied ? 'copied' : 'failed');
      if (!copied) fieldRef.current?.select();
    });
  };

  return (
    <div className="invite">
      <p className="panel-label">Code de la partie</p>
      <p className="invite__code" data-room-code={code}>
        {formatCode(code)}
      </p>
      <button
        type="button"
        className={copy === 'copied' ? 'invite__copy invite__copy--done' : 'invite__copy'}
        onClick={onCopy}
      >
        <span key={copy} className="invite__copy-label">
          {copy === 'copied' ? 'Lien copié' : 'Copier le lien d’invitation'}
        </span>
      </button>
      <span className="visually-hidden" role="status">
        {copy === 'copied' ? LINK_COPIED : ''}
      </span>
      {copy === 'failed' && (
        <div className="invite__fallback">
          <p className="invite__error" id={messageId} role="alert">
            {COPY_FAILED}
          </p>
          <input
            ref={fieldRef}
            className="invite__field"
            type="text"
            readOnly
            value={link}
            aria-label="Lien d’invitation"
            aria-describedby={messageId}
            onFocus={(event) => {
              event.currentTarget.select();
            }}
          />
        </div>
      )}
    </div>
  );
}
