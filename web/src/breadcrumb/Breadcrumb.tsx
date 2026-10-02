export interface BreadcrumbProps {
  /** Root-first ids (node or group) of the deepest currently-expanded path; last entry is the
   * deepest (data-model.md: derived, not stored). Empty when nothing is expanded. */
  path: string[];
  getName: (id: string) => string;
  onNavigate: (id: string) => void;
}

/** Reflects the deepest currently-expanded path (FR-007); clicking an ancestor scrolls its
 * already-expanded block into view — there is no separate navigation/camera to move (FR-018). */
export function Breadcrumb({ path, getName, onNavigate }: BreadcrumbProps) {
  if (path.length === 0) {
    return (
      <nav aria-label="Breadcrumb" className="breadcrumb" data-testid="breadcrumb">
        <span className="breadcrumb-item breadcrumb-current" data-testid="breadcrumb-current" />
      </nav>
    );
  }

  const ancestorIds = path.slice(0, -1);
  const currentId = path[path.length - 1];

  return (
    <nav aria-label="Breadcrumb" className="breadcrumb" data-testid="breadcrumb">
      {ancestorIds.map((id) => (
        <span key={id} className="breadcrumb-item">
          <button
            type="button"
            onClick={() => onNavigate(id)}
            data-testid={`breadcrumb-item-${id}`}
          >
            {getName(id)}
          </button>
          <span aria-hidden="true"> / </span>
        </span>
      ))}
      <span className="breadcrumb-item breadcrumb-current" data-testid="breadcrumb-current">
        {getName(currentId)}
      </span>
    </nav>
  );
}
