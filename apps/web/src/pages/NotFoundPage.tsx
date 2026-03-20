import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <section className="page-grid">
      <article className="panel panel-error">
        <p className="eyebrow">404</p>
        <h2>Route not found</h2>
        <p className="lead">
          This path is not part of the current Pocker workspace shell.
        </p>
        <Link className="button-primary" to="/">
          Back to home
        </Link>
      </article>
    </section>
  );
}
