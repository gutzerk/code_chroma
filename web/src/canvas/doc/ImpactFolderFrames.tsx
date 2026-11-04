import type { CanvasElement } from "../../state/types";
import type { MeasuredBoxSize } from "../useMeasuredSizes";
import { useCanvasFocus } from "../CanvasFocusContext";
import { inspectorStore } from "../inspectorStore";
import { unionBoundsOf } from "./boundingBox";
import { FOLDER_PAD, impactBoxesOf, impactFoldersOf } from "./impactBoardLayout";
import { SoftAreaFrame } from "./SoftAreaFrame";

const TINTS = 3;

/** The Impact board's folder frames: one tinted, labelled area per top-level folder, drawn behind its cards. */
export function ImpactFolderFrames({
  layer,
  members,
  sizes,
}: {
  layer: string;
  members: CanvasElement[];
  sizes: ReadonlyMap<string, MeasuredBoxSize>;
}) {
  const focusNode = useCanvasFocus();
  // No memo: CanvasDocView hands over a fresh `members` array every render, so one would never hit.
  const boxes = impactBoxesOf(members);
  const folders = impactFoldersOf(boxes);
  const areas = [...new Set(folders.map((folder) => folder.area))];
  const byId = new Map(boxes.map((box) => [box.id, box] as const));
  return (
    <>
      {folders.map((folder) => {
        const bounds = unionBoundsOf(folder.ids.flatMap((id) => byId.get(id) ?? []), sizes);
        if (!bounds) return null;
        const tint = areas.indexOf(folder.area) % TINTS;
        const sourceId = folder.label === "other" || folder.label === "(repo root)" ? null : `dir::${folder.label}`;
        return (
          <SoftAreaFrame
            key={folder.key}
            bounds={bounds}
            padding={FOLDER_PAD}
            className={`impact-folder impact-folder--tint-${tint}`}
            testId="impact-folder"
            labelClassName="impact-folder-label"
            label={folder.label}
            layer={layer}
            labelAction={
              sourceId && (
                <button
                  type="button"
                  className="impact-folder-open"
                  aria-label={`Open ${folder.label}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => {
                    focusNode(sourceId);
                    inspectorStore.open(sourceId, folder.label);
                  }}
                >
                  ↗
                </button>
              )
            }
          />
        );
      })}
    </>
  );
}
