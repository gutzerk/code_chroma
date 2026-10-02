import Prism from "prismjs";
import "prismjs/components/prism-json";
import { createPrismHighlighter } from "./prismAdapter";

export const jsonHighlighter = createPrismHighlighter("json", Prism.languages.json);
