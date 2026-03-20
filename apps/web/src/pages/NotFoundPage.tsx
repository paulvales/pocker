import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="ui container" style={{ padding: '2rem 1rem' }}>
      <div className="ui warning message">
        <div className="header">404</div>
        <p>Маршрут не найден.</p>
        <Link className="ui primary button" to="/">
          На главную
        </Link>
      </div>
    </div>
  );
}
