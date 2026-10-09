import type { CanvasPosition } from "../state/types";

/** Hand-arranged block positions per diagram, keyed by each element's `meta.recipe_key`;
 * the lesson restores them after "drawing" so every run lands on the same layout. */
export const TUTORIAL_LAYOUTS: Record<string, Record<string, CanvasPosition>> = {
  impact: {
    "backend/app.py::function::handle_create_todo": { x: 0, y: 0 },
    "backend/service.py::function::add_todo": { x: 0, y: 320 },
    "backend/service.py::function::validate_title": { x: -480, y: 660 },
    "db/repository.py::function::insert": { x: 480, y: 660 },
    "backend/service.py::function::remove_todo": { x: 960, y: 320 },
  },
  patterns: {
    "infra::frontend": {
      x: -69,
      y: -357,
    },
    "infra::handlers": {
      x: -68,
      y: -103,
    },
    "facade::todo_service": {
      x: 407,
      y: 205,
    },
    "fn::list_all_todos": {
      x: -690,
      y: -109,
    },
    "fn::add_todo": {
      x: -73,
      y: 239,
    },
    "fn::finish_todo": {
      x: -483,
      y: 167,
    },
    "repository::todo_repository": {
      x: 413,
      y: 836,
    },
    "fn::fetch_all": {
      x: -690,
      y: 870,
    },
    "fn::insert": {
      x: -69,
      y: 479,
    },
    "fn::mark_done": {
      x: -479,
      y: 481,
    },
    "ext::sqlite": {
      x: -136,
      y: 847,
    },
  },
};
