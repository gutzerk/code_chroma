import Prism from "prismjs";
import "prismjs/components/prism-markdown";
import { createPrismHighlighter } from "./prismAdapter";

export const markdownHighlighter = createPrismHighlighter("markdown", Prism.languages.markdown);
