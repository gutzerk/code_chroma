import Prism from "prismjs";
import "prismjs/components/prism-go";
import { createPrismHighlighter } from "./prismAdapter";

export const goHighlighter = createPrismHighlighter("go", Prism.languages.go);
