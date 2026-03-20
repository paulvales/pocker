import { Link } from 'react-router-dom';

const checkpoints = [
  'App shell, routing and error boundaries are isolated from legacy HTML.',
  'Design tokens and global styles are centralized for future feature work.',
  'The room and history flows are represented as route placeholders, not inline script islands.',
];

export function HomePage() {
  return (
    <section className="page-grid">
      <article className="panel panel-hero">
        <p className="eyebrow">APP-14</p>
        <h2>React 19 + TypeScript foundation is ready for migration work.</h2>
        <p className="lead">
          This app intentionally stops before feature parity. The goal here is a
          stable frontend platform for the next React rewrite tasks.
        </p>
        <div className="hero-actions">
          <Link className="button-primary" to="/alpha-room">
            Open room route placeholder
          </Link>
          <Link className="button-secondary" to="/history">
            Open history route placeholder
          </Link>
        </div>
      </article>

      <article className="panel">
        <p className="eyebrow">What exists now</p>
        <ul className="check-list">
          {checkpoints.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </article>
    </section>
  );
}
