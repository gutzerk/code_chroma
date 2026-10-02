import Prism from "prismjs";
import "prismjs/components/prism-kotlin";
import { createPrismHighlighter } from "./prismAdapter";

export const kotlinHighlighter = createPrismHighlighter("kotlin", Prism.languages.kotlin);
