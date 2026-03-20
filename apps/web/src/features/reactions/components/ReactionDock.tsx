import { useEffect, useRef, useState } from 'react';

import { AVAILABLE_REACTIONS } from '../model/reactionCatalog';

type ReactionDockProps = {
  activeReaction: string | null;
  canReact: boolean;
  pending: boolean;
  onSelectReaction: (value: string | null) => Promise<void>;
};

export function ReactionDock({
  activeReaction,
  canReact,
  pending,
  onSelectReaction,
}: ReactionDockProps) {
  const [open, setOpen] = useState(false);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const isOpen = canReact && open;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleDocumentClick(event: MouseEvent) {
      if (!dockRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('click', handleDocumentClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  if (!canReact) {
    return null;
  }

  return (
    <div className="reaction-dock is-visible" ref={dockRef}>
      <div className={`reaction-picker${isOpen ? ' open' : ''}`}>
        {AVAILABLE_REACTIONS.map((reaction) => {
          const isActive = reaction.value === activeReaction;

          return (
            <button
              key={reaction.value}
              className={`reaction-option${isActive ? ' active' : ''}`}
              type="button"
              aria-label={reaction.label}
              aria-pressed={isActive}
              disabled={pending}
              onClick={() => {
                void onSelectReaction(
                  activeReaction === reaction.value ? null : reaction.value,
                ).then(() => {
                  setOpen(false);
                }).catch(() => {});
              }}
            >
              {reaction.value}
            </button>
          );
        })}
      </div>

      <button
        className={`reaction-trigger${activeReaction ? ' has-reaction' : ''}${
          isOpen ? ' open' : ''
        }`}
        type="button"
        aria-expanded={isOpen}
        aria-label="Open reaction picker"
        disabled={pending}
        onClick={() => {
          setOpen((currentState) => !currentState);
        }}
      >
        <span className="reaction-trigger-emoji">{activeReaction || '😊'}</span>
      </button>
    </div>
  );
}
