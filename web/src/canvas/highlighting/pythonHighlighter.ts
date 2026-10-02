import Prism from "prismjs";
import "prismjs/components/prism-python";
import { createPrismHighlighter } from "./prismAdapter";

export const pythonHighlighter = createPrismHighlighter("python", Prism.languages.python);
