import Prism from "prismjs";
import "prismjs/components/prism-ruby";
import { createPrismHighlighter } from "./prismAdapter";

export const rubyHighlighter = createPrismHighlighter("ruby", Prism.languages.ruby);
