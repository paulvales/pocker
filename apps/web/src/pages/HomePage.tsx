import { startTransition, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { buildRoomPath, isValidRoomSlug, normalizeRoomSlug } from '@/features/rooms/model/roomRoute';
import {
  readStoredPlayerName,
  writeStoredAdminIntent,
  writeStoredCreateRoomIntent,
  writeStoredPlayerName,
} from '@/features/rooms/model/sessionPersistence';
import { readAppVersionLabel } from '@/shared/appVersion';

const DEFAULT_ROOM_HELP_TEXT = 'Введите slug комнаты. Он и станет адресом вида /slug/.';
const DEFAULT_STATUS_TEXT = 'Сначала создайте комнату или откройте готовую ссылку.';

export function HomePage() {
  const navigate = useNavigate();
  const [roomSlug, setRoomSlug] = useState('');
  const [playerName, setPlayerName] = useState(() => readStoredPlayerName());
  const normalizedRoomSlug = useMemo(() => normalizeRoomSlug(roomSlug), [roomSlug]);
  const roomSlugIsValid = useMemo(() => isValidRoomSlug(roomSlug), [roomSlug]);
  const versionLabel = readAppVersionLabel();

  useEffect(() => {
    document.title = 'Scrum Poker';
    document.body.classList.add('legacy-room-body');
    return () => {
      document.body.classList.remove('legacy-room-body');
    };
  }, []);

  function handleCreateRoom() {
    const trimmedName = playerName.trim();
    if (!trimmedName) {
      return;
    }
    if (!roomSlugIsValid || !normalizedRoomSlug) {
      return;
    }

    writeStoredPlayerName(trimmedName);
    writeStoredAdminIntent(normalizedRoomSlug, true);
    writeStoredCreateRoomIntent(normalizedRoomSlug);

    startTransition(() => {
      void navigate(buildRoomPath(normalizedRoomSlug));
    });
  }

  const roomHelpText = roomSlug.trim() && !roomSlugIsValid
    ? 'Используйте только буквы, цифры, дефис или underscore. Служебные маршруты запрещены.'
    : DEFAULT_ROOM_HELP_TEXT;

  const statusText = playerName.trim()
    ? DEFAULT_STATUS_TEXT
    : 'Введите имя перед созданием комнаты.';

  return (
    <>
      <div className="ui basic center aligned segment page-hero" style={{ paddingTop: 0 }}>
        <div className="ui basic center aligned" style={{ marginBottom: 0 }}>
          <h2 className="ui header">Скрум Покер Онлине</h2>
        </div>

        <div className="ui segment" id="joinPanel">
          <form className="ui large form" id="joinForm">
            <div className="join-grid">
              <div className="join-field field" id="roomBuilderField">
                <label htmlFor="roomSuffix">Название комнаты</label>
                <div className="ui fluid input">
                  <input
                    id="roomSuffix"
                    type="text"
                    value={roomSlug}
                    placeholder="SCKZQA"
                    onChange={(event) => {
                      setRoomSlug(event.target.value);
                    }}
                  />
                </div>
                <div className="join-meta" id="roomHelpText">
                  {roomHelpText}
                </div>
              </div>

              <div
                className="join-field field hidden"
                id="roomLinkField"
                style={{ display: 'none' }}
              >
                <label htmlFor="roomLinkInput">Ссылка комнаты</label>
                <div className="ui fluid action input join-room-link">
                  <input id="roomLinkInput" type="text" readOnly />
                  <button className="ui button" id="copyRoomLinkBtn" type="button">
                    Копировать
                  </button>
                </div>
                <div className="join-meta" id="roomLinkHelpText">
                  Скопируйте ссылку и отправьте её команде.
                </div>
              </div>

              <div className="join-field field" id="playerNameField">
                <label htmlFor="playerName">Ваше имя</label>
                <div className="ui fluid input">
                  <input
                    id="playerName"
                    type="text"
                    value={playerName}
                    placeholder="Ваше имя"
                    onChange={(event) => {
                      setPlayerName(event.target.value);
                    }}
                  />
                </div>
                <div className="join-meta" id="roomStatusText">
                  {statusText}
                </div>
              </div>

              <div className="join-actions">
                <button
                  className="ui primary large button onlyAuth"
                  id="createRoomBtn"
                  type="button"
                  onClick={handleCreateRoom}
                >
                  Создать комнату
                </button>
                <button
                  className="ui large basic button onlyAuth"
                  id="iAmAdmin"
                  style={{ display: 'none' }}
                  type="button"
                >
                  Я админ
                </button>
                <button
                  className="ui primary large button onlyAuth"
                  id="joinBtn"
                  style={{ display: 'none' }}
                  type="button"
                >
                  Войти
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      <div className="httpsNotice">
        <span>{versionLabel ? `v ${versionLabel}` : 'v'}</span>
        <a
          href="https://www.notion.so/303d22895e1580e88e47cb42885696b2"
          target="_blank"
          rel="noreferrer"
        >
          если проблемы с сертификатом
        </a>
      </div>
    </>
  );
}
