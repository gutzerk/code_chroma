import Prism from "prismjs";
import "prismjs/components/prism-c";
import { createPrismHighlighter } from "./prismAdapter";

export const cHighlighter = createPrismHighlighter("c", Prism.languages.c);
