import Prism from "prismjs";
import "prismjs/components/prism-markup-templating";
import "prismjs/components/prism-jsx";
import { createPrismHighlighter } from "./prismAdapter";

export const jsxHighlighter = createPrismHighlighter("jsx", Prism.languages.jsx);
