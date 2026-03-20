import { HTTP_ROUTES } from '@contracts';

export function HistoryPage() {
  return (
    <section className="page-grid">
      <article className="panel panel-stage">
        <p className="eyebrow">History Route Skeleton</p>
        <h2>Estimate history will move here.</h2>
        <p className="lead">
          APP-20 will connect filters, pagination and API metadata on this page
          through the shared contract for <code>{HTTP_ROUTES.estimationHistory}</code>.
        </p>
      </article>
    </section>
  );
}
