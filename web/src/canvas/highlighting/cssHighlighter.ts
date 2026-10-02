import Prism from "prismjs";
import "prismjs/components/prism-css";
import { createPrismHighlighter } from "./prismAdapter";

export const cssHighlighter = createPrismHighlighter("css", Prism.languages.css);
