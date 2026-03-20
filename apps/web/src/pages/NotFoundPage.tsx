import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <section className="page-grid">
      <article className="panel panel-error">
        <p className="eyebrow">404</p>
        <h2>Route not found</h2>
        <p className="lead">
          The foundation router is active, but this path is not part of the
          current scaffold.
        </p>
        <Link className="button-primary" to="/">
          Back to overview
        </Link>
      </article>
    </section>
  );
}
