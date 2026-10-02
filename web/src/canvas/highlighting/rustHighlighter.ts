import Prism from "prismjs";
import "prismjs/components/prism-rust";
import { createPrismHighlighter } from "./prismAdapter";

export const rustHighlighter = createPrismHighlighter("rust", Prism.languages.rust);
