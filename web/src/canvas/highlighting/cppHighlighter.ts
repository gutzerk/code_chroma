import Prism from "prismjs";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import { createPrismHighlighter } from "./prismAdapter";

export const cppHighlighter = createPrismHighlighter("cpp", Prism.languages.cpp);
