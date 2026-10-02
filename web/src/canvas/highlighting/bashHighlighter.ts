import Prism from "prismjs";
import "prismjs/components/prism-bash";
import { createPrismHighlighter } from "./prismAdapter";

export const bashHighlighter = createPrismHighlighter("bash", Prism.languages.bash);
