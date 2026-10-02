import Prism from "prismjs";
import "prismjs/components/prism-java";
import { createPrismHighlighter } from "./prismAdapter";

export const javaHighlighter = createPrismHighlighter("java", Prism.languages.java);
