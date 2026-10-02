import Prism from "prismjs";
import "prismjs/components/prism-csharp";
import { createPrismHighlighter } from "./prismAdapter";

export const csharpHighlighter = createPrismHighlighter("csharp", Prism.languages.csharp);
