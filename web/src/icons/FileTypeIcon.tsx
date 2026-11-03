import { fileTypeGlyph } from "./fileTypes";
import { NodeKindIcon } from "./NodeKindIcon";

/** IDE-style file icon for the Files panel: the language/tool logo, else the generic file glyph. */
export function FileTypeIcon({ fileName }: { fileName: string }) {
  const glyph = fileTypeGlyph(fileName);
  if (!glyph) return <NodeKindIcon level="file" />;
  return (
    <svg
      className="node-icon file-type-icon"
      data-file-type={glyph.slug}
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden="true"
    >
      <path fill={glyph.fill} d={glyph.path} />
    </svg>
  );
}
