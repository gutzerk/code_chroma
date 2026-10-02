import Prism from "prismjs";
import "prismjs/components/prism-markup-templating";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-tsx";
import { createPrismHighlighter } from "./prismAdapter";

export const tsxHighlighter = createPrismHighlighter("tsx", Prism.languages.tsx);
