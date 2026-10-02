import Prism from "prismjs";
import "prismjs/components/prism-yaml";
import { createPrismHighlighter } from "./prismAdapter";

export const yamlHighlighter = createPrismHighlighter("yaml", Prism.languages.yaml);
