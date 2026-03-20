import { SOCKET_EVENT_NAMES } from '@contracts';
import { useParams } from 'react-router-dom';

export function RoomPage() {
  const { roomSlug } = useParams();

  return (
    <section className="page-grid">
      <article className="panel panel-stage">
        <p className="eyebrow">Room Route Skeleton</p>
        <h2>{roomSlug ? `/${roomSlug}` : 'Room slug missing'}</h2>
        <p className="lead">
          This route is the landing zone for APP-18 and APP-19. The UI shell is
          ready, but realtime room features are not connected yet.
        </p>
        <p className="lead">
          Planned first events: <code>{SOCKET_EVENT_NAMES.client.join}</code>,{' '}
          <code>{SOCKET_EVENT_NAMES.client.vote}</code> and{' '}
          <code>{SOCKET_EVENT_NAMES.client.reveal}</code>.
        </p>
      </article>

      <article className="panel panel-subtle">
        <p className="eyebrow">Next tasks</p>
        <p>
          Room entry, session shell, voting, tasks and reactions will be added
          on top of this route after the realtime client layer exists.
        </p>
      </article>
    </section>
  );
}
