# Changelog

## [1.6.1](https://github.com/gutzerk/code_chroma/compare/v1.6.0...v1.6.1) (2026-10-24)


### Bug Fixes

* address stage branch review findings ([1b117d6](https://github.com/gutzerk/code_chroma/commit/1b117d622a9f2161e5c947fa94af0b7ebba10d23))
* address stage branch review findings (questions, workflows, agents panel, model catalog) ([b860d23](https://github.com/gutzerk/code_chroma/commit/b860d23e9b26b9f908dd2c92235202527404df2a))
* tidy review nits (dead gh timeout const, IOException in Gh.Execute, clearer parity-test failures) ([8aba2cb](https://github.com/gutzerk/code_chroma/commit/8aba2cbe37dc222cf156c0ec488ed18c085bbafe))

## [1.6.0](https://github.com/gutzerk/code_chroma/compare/v1.5.0...v1.6.0) (2026-10-23)


### Features

* **llm:** built-in model suggestions when a provider can't list models live ([af79917](https://github.com/gutzerk/code_chroma/commit/af79917e3f4260b76709829eb7a0dd58ac655d2c))
* **llm:** built-in model suggestions when a provider can't list models live ([f259165](https://github.com/gutzerk/code_chroma/commit/f25916514dcbbe1b3839db34ecec90201b2b5dac))
* **questions:** enforce the ask_user contract and add option diagrams ([50cdfb9](https://github.com/gutzerk/code_chroma/commit/50cdfb91dbf783a26244aa01849dc25b698e737b))
* **questions:** enforce the ask_user contract and add option diagrams ([a530acd](https://github.com/gutzerk/code_chroma/commit/a530acd9064b06b6a4cfff54af3794d3cdf8d3be))
* share the canvas style across projects through the bridge ([ddead66](https://github.com/gutzerk/code_chroma/commit/ddead66076e81ff63d2531f04af091f9d0932428)), closes [#236](https://github.com/gutzerk/code_chroma/issues/236)
* **web:** apply the workflow and agents panel design on top of the agent-sessions workflow logic ([68f77b1](https://github.com/gutzerk/code_chroma/commit/68f77b126e7b311ce28046779d3da4df8e3a11bb))
* **web:** show agent questions in the terminal, agent LEDs and activity panel ([2d41887](https://github.com/gutzerk/code_chroma/commit/2d418878b9750742fc9acdf7df8287515f19b72a))
* **web:** workflow and agents panel design on top of agent-sessions logic ([ef82f94](https://github.com/gutzerk/code_chroma/commit/ef82f94eb6a8813caa2cbcb56f880ab062021b4a))


### Bug Fixes

* apply button for canvas style, restyle update result dialog ([b3ee85c](https://github.com/gutzerk/code_chroma/commit/b3ee85ce8a8f779168dc4b5d4035430363a76775))
* Apply button for canvas style, restyle update result dialog ([aad77d3](https://github.com/gutzerk/code_chroma/commit/aad77d3b67de46820c4b10850256b3e74f3800e6))
* canvas style reset/apply semantics, cap update detail height ([4100129](https://github.com/gutzerk/code_chroma/commit/41001296065e7778aa95537afaea1f848d986b4b))
* delete only the resolved workflow copy and lock the shared directory process-wide ([75e9f58](https://github.com/gutzerk/code_chroma/commit/75e9f58a4c3b3e3975852791719f6dcd0f0d2420))
* machine-wide workflows and accurate session token usage ([2a5c1e9](https://github.com/gutzerk/code_chroma/commit/2a5c1e9bba5fded3aea9fb84352dccf22edccac1))
* machine-wide workflows, canvas style and accurate session token usage ([b060885](https://github.com/gutzerk/code_chroma/commit/b060885066a87ec22fbb42989be97a61d2bf489f))
* **questions:** address 021 review findings ([a8a3b67](https://github.com/gutzerk/code_chroma/commit/a8a3b673b0f0e104e6fb8414240c72bff3692b0b))
* surface gh errors on issue create, show update progress, clearer post-update dialog ([4733f7b](https://github.com/gutzerk/code_chroma/commit/4733f7ba6c6a75e9afe4644ff82e021c33268e2d))
* surface gh errors on issue create, show update progress, clearer post-update dialog ([6c9e34f](https://github.com/gutzerk/code_chroma/commit/6c9e34fe917e15900e37a37a0abb43451cf182d4))
* **updater:** report the update result before launching the new version ([985419c](https://github.com/gutzerk/code_chroma/commit/985419cec71f644e757abbf2360bb4837bf6acf7))
* **updater:** report the update result before launching the new version ([6452030](https://github.com/gutzerk/code_chroma/commit/6452030517b0c9f0c20a5b4465a0909ef1cea9ea))
* **web:** address review of the workflow and agents panel design ([f7a0d3a](https://github.com/gutzerk/code_chroma/commit/f7a0d3ac6b0ed4b7a3a79dc430464a4292c47ab4))

## [1.5.0](https://github.com/gutzerk/code_chroma/compare/v1.4.0...v1.5.0) (2026-10-23)


### Features

* **web:** float the agents panel over the canvas and sync full-screen controls ([b3e4d04](https://github.com/gutzerk/code_chroma/commit/b3e4d04eafd170ddbbc2704bfd27a07f54a83c42))
* **web:** float the agents panel over the canvas and sync full-screen controls ([cd10ece](https://github.com/gutzerk/code_chroma/commit/cd10ece4d28e58406250833456549d0a244c694d))


### Bug Fixes

* agent panel close/usage, full-screen tab isolation, wiki Update style, issue-created dialog ([e45c89a](https://github.com/gutzerk/code_chroma/commit/e45c89a3f0a529af74c7f0bec07d3cecd199b3b3))
* agent panel close/usage, full-screen tab isolation, wiki Update style, issue-created dialog ([4a6cdb8](https://github.com/gutzerk/code_chroma/commit/4a6cdb84ceaa4b7b92c7fec6d09120d7a7674e19))
* **web:** address review of the floating agents panel ([9cbb4d0](https://github.com/gutzerk/code_chroma/commit/9cbb4d0b42a19e807037255f5318b4b77620c233))

## [1.4.0](https://github.com/gutzerk/code_chroma/compare/v1.3.1...v1.4.0) (2026-10-22)


### Features

* **agents:** session usage strip in the agents full screen (019 stage 7) ([8701fab](https://github.com/gutzerk/code_chroma/commit/8701fabc00344ca950c8c21fff37991c7b877fb5))
* **workflows:** agent mode cards, per-step provider/model and step input in the editor (019 stage 4) ([3f679dd](https://github.com/gutzerk/code_chroma/commit/3f679ddee2b01863f7ed498909234448331ff0d3))
* **workflows:** All workflows screen and panel top bar (019 stage 6) ([3897bbe](https://github.com/gutzerk/code_chroma/commit/3897bbec667679cd3d04eccf01325f9cbd537391))
* **workflows:** per-step agent mode, extra prompt, provider and model in the definition (019 stage 0) ([c65e712](https://github.com/gutzerk/code_chroma/commit/c65e712c2e9697374e3846dd304317ecd4a19931))
* **workflows:** per-step CLI, step input and continue sessions in the runner (019 stage 1) ([46fe88b](https://github.com/gutzerk/code_chroma/commit/46fe88b67b88c7b13c280f3a9960533ef0983a6d))
* **workflows:** record step token usage and continue-chain length (019 stage 2) ([1f629c5](https://github.com/gutzerk/code_chroma/commit/1f629c56c6a9cac5e90141cb930ecfd4e2d6da44))
* **workflows:** redo and send back share one rerun path that forks an earlier session (019 stage 3) ([f515e22](https://github.com/gutzerk/code_chroma/commit/f515e22e43fef475a5fee6d4cc1a00d718b6dc9b))
* **workflows:** step mode labels, session badge, resume chip and Open agent in run views (019 stage 5) ([fe51dae](https://github.com/gutzerk/code_chroma/commit/fe51daedc3ff4796fd3371fa32ea2ed94a2a8184))
* write live bridge origin to .codechroma/bridge.json on every start ([#216](https://github.com/gutzerk/code_chroma/issues/216)) ([1aa037e](https://github.com/gutzerk/code_chroma/commit/1aa037ee79d3dea04c69f032c3b7a6498c4cf65b))


### Bug Fixes

* **canvas:** align diagram colors and preserve arranged positions ([1dfb679](https://github.com/gutzerk/code_chroma/commit/1dfb6795513bd66f9ecfe202ae9522cbc80c36ce))
* **canvas:** retain user block edits across arrange mode changes ([f5827d6](https://github.com/gutzerk/code_chroma/commit/f5827d6ec9cc0ddb56d772d2d229e44e2658062c))
* **ci:** retry transient PowerShell Gallery download failures ([bc0c6bf](https://github.com/gutzerk/code_chroma/commit/bc0c6bff6f9b4c0e827b8c945a12dfd41961addb))
* **shell-tests:** keep the fake bridge alive when a client aborts mid-response ([1e7cc5c](https://github.com/gutzerk/code_chroma/commit/1e7cc5cda091ef4cded36f7bb5b93bc5a247c6d0))
* stable per-repository bridge port with free-port fallback ([#216](https://github.com/gutzerk/code_chroma/issues/216)) ([0435433](https://github.com/gutzerk/code_chroma/commit/04354333281e06a51547e764591a49bee7567c05))
* **workflows:** protect agent workspaces and round-trip inputs ([16df855](https://github.com/gutzerk/code_chroma/commit/16df855653c39827f84950220c51984192d05e46))

## [1.3.1](https://github.com/gutzerk/code_chroma/compare/v1.3.0...v1.3.1) (2026-10-22)


### Bug Fixes

* agent panel full screen, agent tabs, collapse handle, paste and hidden draw skill ([98b523c](https://github.com/gutzerk/code_chroma/commit/98b523ce949ad4d460f144608250e22b7c6ef0fb))
* **agents:** agent window full-screen, switcher, focus, paste and hidden skill text ([282323b](https://github.com/gutzerk/code_chroma/commit/282323b55f8be5e7bd1aa771e30c692f2bd67d73))
* **bridge:** ping canvases when a custom or feature-plan diagram is written ([d988bbe](https://github.com/gutzerk/code_chroma/commit/d988bbe357ed1309cc9a4d3a5526f75e423d0cb9))
* **bridge:** ping canvases when a custom or feature-plan diagram is written ([5c028fb](https://github.com/gutzerk/code_chroma/commit/5c028fb264bc48353b413857f0761e2d731f2aad))
* **bridge:** skip macOS-protected home folders when walking a non-git folder ([fb0f040](https://github.com/gutzerk/code_chroma/commit/fb0f0409769e86d51d9d9cfa5977208d28b1b70d))
* **bridge:** surface wiki update errors in status and update sequence self-relation contract ([09c29c6](https://github.com/gutzerk/code_chroma/commit/09c29c60d61dc7de9db5e10a175c69ced4a31f0b))
* **shell:** ignore trailing separator when matching macOS-protected folders ([00092d9](https://github.com/gutzerk/code_chroma/commit/00092d977b3b5ba1db65fc9100b7c1cf6515ded9))
* **shell:** skip macOS-protected home folders when scanning a non-repo folder ([8fe2441](https://github.com/gutzerk/code_chroma/commit/8fe24415189612350b3b5a0cd70fd536d931265f)), closes [#189](https://github.com/gutzerk/code_chroma/issues/189)
* **skills,bridge:** export agent env, verify wiki update writes, fix diagram check gaps ([d08af91](https://github.com/gutzerk/code_chroma/commit/d08af91c205c3937a753f7bae90aa6d998080e5c))
* **skills:** export bridge identity env vars and harden wiki/diagram skill flows ([3f27f12](https://github.com/gutzerk/code_chroma/commit/3f27f122e0824ac78e1b0adf3d74e18d7e1a9430))
* **skills:** stop routing data-flow and other flow requests to the sequence diagram ([1fd3098](https://github.com/gutzerk/code_chroma/commit/1fd3098b3ee5fe535a095f5fd8f428c168c7ee72))
* **skills:** stop routing data-flow and other flow requests to the sequence diagram ([665ad26](https://github.com/gutzerk/code_chroma/commit/665ad263e93bc41b07d2efa99ea879a3cdd46432))
* **web:** lower canvas zoom-out floor and hide stray scrollbars ([77218b9](https://github.com/gutzerk/code_chroma/commit/77218b9b4a4e561fdbfbf557b09e8cc606ec7461))
* **web:** lower canvas zoom-out floor and hide stray scrollbars ([7df0729](https://github.com/gutzerk/code_chroma/commit/7df07291846c1c6da8108e9b08424d113c404294))
* **workflows:** bind run inputs to steps with a single question field ([13b5b83](https://github.com/gutzerk/code_chroma/commit/13b5b831a9ad6b69b5ed87e860c338bc75269a56))
* **workflows:** clickable cards, cancel awaiting-review runs, single-field run inputs ([82828be](https://github.com/gutzerk/code_chroma/commit/82828be7289bf3d8b82be6a0e7aee5e592526b2c))
* **workflows:** clickable cards, cancel waiting runs, per-step single input ([fdb13fd](https://github.com/gutzerk/code_chroma/commit/fdb13fdf8325490270dd1027c07e7f423a3799db))

## [1.3.0](https://github.com/gutzerk/code_chroma/compare/v1.2.0...v1.3.0) (2026-10-22)


### Features

* **bridge:** gather architecture-map context for c1, patterns, sequence and custom diagrams ([63e9fda](https://github.com/gutzerk/code_chroma/commit/63e9fda6188058c7cb699ec899b7cb92b8ed5f05))
* **bridge:** gather architecture-map context for diagram agents ([362f79c](https://github.com/gutzerk/code_chroma/commit/362f79c309e83c24a4a99c7ea609ce0e9f12f6e9))
* **bridge:** start diagram task agents bare, with the draw skill inlined ([9710620](https://github.com/gutzerk/code_chroma/commit/971062054c307ce6fd185667a2c0742e271f4260))
* **web:** highlight diagram-drawing agents in the activity panel ([180931c](https://github.com/gutzerk/code_chroma/commit/180931ca06b83d86b2f32eaf29a402e6ce6c4a26))
* **web:** highlight diagram-drawing agents in the activity panel ([86a1f27](https://github.com/gutzerk/code_chroma/commit/86a1f27a9338f477670ac55d2466f9e21fa26270))
* **workflows:** redesign the agents/workflows panel and workflow backend ([fec4a7a](https://github.com/gutzerk/code_chroma/commit/fec4a7aac97471ba91637e9e3429ff517a9e86c2))
* **workflows:** redesign the agents/workflows panel and workflow backend ([448337f](https://github.com/gutzerk/code_chroma/commit/448337f0bec983c48e560b77229e166ebd7bc934))


### Bug Fixes

* **bridge:** keep long wiki update prompts off the Windows command line; style side panels like the design ([3f5acaf](https://github.com/gutzerk/code_chroma/commit/3f5acaf678b3ccc8e641cad36e1d51b3e07366a8))
* **bridge:** let interactive diagram agents run the context command themselves ([065e721](https://github.com/gutzerk/code_chroma/commit/065e7211f9c1e4ac83056452e6d4ae94c782fe6c))
* **bridge:** warm the embedding model only when the desktop app asks for it ([88c036a](https://github.com/gutzerk/code_chroma/commit/88c036a26762df8f371cf311d491b4f836d72f35))
* **shell:** let the Windows update helper move the install dir aside ([a3200f6](https://github.com/gutzerk/code_chroma/commit/a3200f6a87f7a2e0efb45a820682f2f3a3b197d2))
* **shell:** render update notes as markdown, fit screen, add Install/Skip/Later ([fd647d3](https://github.com/gutzerk/code_chroma/commit/fd647d37002a935f0b3cb91fd8141e7d08295490))
* wiki update on Windows (command line too long) and side panel styling ([c5ddf33](https://github.com/gutzerk/code_chroma/commit/c5ddf337ef06ca47bc4bf674985e356debdc675e))
* **wiki-general:** batch wiki-context lookups to avoid HTTP 414 ([dc119f5](https://github.com/gutzerk/code_chroma/commit/dc119f532738b46a07fd90b259cad9173305ad61))
* **wiki-general:** batch wiki-context path lookups so large wikis don't hit HTTP 414 ([8fc0cdd](https://github.com/gutzerk/code_chroma/commit/8fc0cdd89ae9ae39accc228b9776f22f41284d8a))
* Windows CLI path lookup and update dialog rendering ([7e6eeeb](https://github.com/gutzerk/code_chroma/commit/7e6eeebd10a3ddaa9ba49ac79a19202230ce9be0))
* **workflows:** review fixes for delete, clear-finished, previous-step context and sendBackTo ([03d3a0b](https://github.com/gutzerk/code_chroma/commit/03d3a0b76da9c5eb8933c399a51bd00a6b66fc01))

## [1.2.0](https://github.com/gutzerk/code_chroma/compare/v1.1.0...v1.2.0) (2026-10-21)


### Features

* attach agents and workflows to the canvas activity panel ([b8a82cc](https://github.com/gutzerk/code_chroma/commit/b8a82ccaf070dbc607b5e5c670b25f40e757276e))
* attach agents and workflows to the canvas activity panel ([2c25041](https://github.com/gutzerk/code_chroma/commit/2c25041d4ba1936ea7b701006792e35c80f59681))
* **web:** attach agents and workflows to the canvas activity panel ([f5562cd](https://github.com/gutzerk/code_chroma/commit/f5562cdf2ff853d4f0c8f015cdefd3564449c8ac))
* workflow skills, inputs, skip and delete; resizable activity panel; collapsed panel summary ([b8a82cc](https://github.com/gutzerk/code_chroma/commit/b8a82ccaf070dbc607b5e5c670b25f40e757276e))
* workflow skills, inputs, skip and delete; resizable activity panel; collapsed panel summary ([2c25041](https://github.com/gutzerk/code_chroma/commit/2c25041d4ba1936ea7b701006792e35c80f59681))
* workflow skills, inputs, skip and delete; resizable activity panel; collapsed panel summary ([a29b713](https://github.com/gutzerk/code_chroma/commit/a29b713e4f1959ee258627026421ce590d9c8e6a))


### Bug Fixes

* align canvas tokens, icons and workflow rail styling with design handoff ([b8a82cc](https://github.com/gutzerk/code_chroma/commit/b8a82ccaf070dbc607b5e5c670b25f40e757276e))
* align canvas tokens, icons and workflow rail styling with design handoff ([2c25041](https://github.com/gutzerk/code_chroma/commit/2c25041d4ba1936ea7b701006792e35c80f59681))
* code sidebar close/markdown/highlight, arrange by frame, terminal and panel overlaps, drop quick draw ([b8a82cc](https://github.com/gutzerk/code_chroma/commit/b8a82ccaf070dbc607b5e5c670b25f40e757276e))
* code sidebar close/markdown/highlight, arrange by frame, terminal and panel overlaps, drop quick draw ([2c25041](https://github.com/gutzerk/code_chroma/commit/2c25041d4ba1936ea7b701006792e35c80f59681))
* code sidebar close/markdown/highlight, arrange by frame, terminal and panel overlaps, drop quick draw ([ac7bb21](https://github.com/gutzerk/code_chroma/commit/ac7bb2168f9056ef6b0e1eaea2dd7f0a70339fad))
* find gh/claude in well-known dirs, clipboard shortcut fallback, always-visible Apply ([b8a82cc](https://github.com/gutzerk/code_chroma/commit/b8a82ccaf070dbc607b5e5c670b25f40e757276e))
* find gh/claude in well-known dirs, clipboard shortcut fallback, always-visible Apply ([2c25041](https://github.com/gutzerk/code_chroma/commit/2c25041d4ba1936ea7b701006792e35c80f59681))
* find gh/claude in well-known dirs, clipboard shortcut fallback, always-visible Apply ([#169](https://github.com/gutzerk/code_chroma/issues/169)) ([6cd8969](https://github.com/gutzerk/code_chroma/commit/6cd896930da761b772b97321d4cd40506650c688))
* **web:** align canvas tokens, icons and workflow rail styling with design handoff ([#170](https://github.com/gutzerk/code_chroma/issues/170)) ([742d6e7](https://github.com/gutzerk/code_chroma/commit/742d6e7190e2e5b5387ccd9ddf8b492f60a2e7df))

## [1.1.0](https://github.com/gutzerk/code_chroma/compare/v1.0.0...v1.1.0) (2026-10-21)


### Features

* fast process diagrams via a local semantic context tool and bare CLI runs ([c0fb8b3](https://github.com/gutzerk/code_chroma/commit/c0fb8b32e006f5dc4f468086e823aa2f1719a335))
* ship skills from skills/ and install them into every project the bridge opens ([eeaabc5](https://github.com/gutzerk/code_chroma/commit/eeaabc59a7339b8735a639565134a6be1430a6a6))
* short inline skill bodies for the c1, patterns, impact and sequence diagrams ([51378e8](https://github.com/gutzerk/code_chroma/commit/51378e8896ee09794a7519c7d763b3355d619bb5))


### Bug Fixes

* align diagram prompts and skill rules where they contradicted each other ([d9b1576](https://github.com/gutzerk/code_chroma/commit/d9b15765c0ca9c0580bafcb0472018013be920e4))
* close the workflow runner races found in the PR 148 review ([036bc18](https://github.com/gutzerk/code_chroma/commit/036bc18237bf12f9523af9126cb1ca7e76e408c1))
* pin actions/checkout in publish-model workflow to a commit sha ([ba8db5c](https://github.com/gutzerk/code_chroma/commit/ba8db5c0cfef8e787e263b1378f69c2bb1578a5e))
* point tests and plugin root at skills/ after the move out of .claude/skills ([447bf99](https://github.com/gutzerk/code_chroma/commit/447bf9903ce1ea383bb2e03387e1e24e1b1fc2ef))

## [1.0.0](https://github.com/gutzerk/code_chroma/compare/v0.12.1...v1.0.0) (2026-10-20)


### ⚠ BREAKING CHANGES

* Electron builds are no longer produced; tag electron-last-build marks the last one.

### Features

* add Canvas style settings (background color and texture) ([b0b5a15](https://github.com/gutzerk/code_chroma/commit/b0b5a15e59c0489e680d62d10930e542a23c0d9f))
* AI questions and grill sessions on the canvas ([a373433](https://github.com/gutzerk/code_chroma/commit/a37343306b50fc9a35cbde1a3e2b9e424519caf1))
* AI questions and grill sessions on the canvas ([3249d52](https://github.com/gutzerk/code_chroma/commit/3249d52c5c8fbf1f9a7e04b6e7d8c0f81a4232e0))
* **bridge:** agent worktree ops, main branch ops, bootstrap, skill sync and diagram seeding in C# ([a3add92](https://github.com/gutzerk/code_chroma/commit/a3add92979caa330ff7498fb5b109b3b9fbc02b3))
* **bridge:** agents, PR workspaces and the PTY terminal host routes in C# ([c6a45eb](https://github.com/gutzerk/code_chroma/commit/c6a45ebed8110eca03a88bfe2f38690ff66a8b77))
* **bridge:** API-provider completion tests, assistant probe and runtime environment contract ([48271e3](https://github.com/gutzerk/code_chroma/commit/48271e304511075064d2f50018a197a6310f189c))
* **bridge:** ASP.NET Core bridge for graph, diagram, workspace and socket routes ([84af45d](https://github.com/gutzerk/code_chroma/commit/84af45d05e06f1d1739a7b81294f45dc3818a612))
* **bridge:** canvas document, apply_batch write point and recipes in C# ([696ae0c](https://github.com/gutzerk/code_chroma/commit/696ae0c2cc6dbbdca103fd3f17986e37cde4eae7))
* **bridge:** canvas/recipes/diffs unit tests, watcher hardening, docs ([8fe237d](https://github.com/gutzerk/code_chroma/commit/8fe237d574b4e353596de302acf66f3f940c5b74))
* **bridge:** contract cases and real-process socket tests for agents, PRs and the PTY terminal; docs ([d46bea8](https://github.com/gutzerk/code_chroma/commit/d46bea847c69c1588a72bb03f404bbf9cb726f76))
* **bridge:** diff, change-card and accept routes in C# ([3353fc8](https://github.com/gutzerk/code_chroma/commit/3353fc8183ea0703ef0e6af5bbdf9d77ceb3179f))
* **bridge:** launch C# bridge with --repo-path/--port, serve canvas, bundle into shell publish (016) ([0dc433a](https://github.com/gutzerk/code_chroma/commit/0dc433a0fd4fe9bf6413c86997e08a2620bd9411))
* **bridge:** native C# analyzers by default, CODECHROMA_ANALYZERS=python fallback ([59cc1db](https://github.com/gutzerk/code_chroma/commit/59cc1dbf6d6901f24c6b3ca3e2154d25933fb8de))
* **bridge:** port assistant, runtime settings, llm settings, traces and issues routes to C# ([55d9dae](https://github.com/gutzerk/code_chroma/commit/55d9dae6c770020f9fa21e9c73c6d249a2351ad6))
* **bridge:** port branch workspaces to C# and document phase 5 bridge progress ([1353943](https://github.com/gutzerk/code_chroma/commit/1353943423a74945620e37c80d7cb04adc7a229b))
* **bridge:** port design-pattern detection and review fixes to the C# core and bridge (017) ([0d645d1](https://github.com/gutzerk/code_chroma/commit/0d645d19d57181e0a784bc00443fa8aac01adb4c))
* **bridge:** port SkillAgent runner, prompts, CLI resolver and generate routes ([908309b](https://github.com/gutzerk/code_chroma/commit/908309bf516c90d63d8b5946d9c531dc179a643d))
* **bridge:** port stream-json rendering and CLI adapters to C# ([e2563c6](https://github.com/gutzerk/code_chroma/commit/e2563c6193091f451b3884882631b380faf14e05))
* **bridge:** port the custom diagram-type library and per-repo custom and feature-plan paths ([14f6711](https://github.com/gutzerk/code_chroma/commit/14f67118948926cbfc0a2c12d0e7db337013bf43))
* **bridge:** port the epics view, AI brief routes, hierarchy layout and context envelope ([65f0df2](https://github.com/gutzerk/code_chroma/commit/65f0df2521e8df3007025d37761c42d84bef668b))
* **bridge:** port the Impact diagram, change review and plain wiki to the C# bridge (017) ([17a840c](https://github.com/gutzerk/code_chroma/commit/17a840cfa4c55a8c5fae8787a4f6f9cb09831ee7))
* **bridge:** port the login-shell runtime environment and its diagnostics routes ([95929b5](https://github.com/gutzerk/code_chroma/commit/95929b51af84bd4d3197c3a4a45aa0351ec2d82e))
* **bridge:** port the wiki-general generate/update pipeline to the C# bridge (017) ([8e8a134](https://github.com/gutzerk/code_chroma/commit/8e8a134e9e7123f07c8c6238fa246d37eb0f2ba5))
* **bridge:** port wiki-general status, interactive status, cancel and context routes ([f8bfef2](https://github.com/gutzerk/code_chroma/commit/f8bfef207178a1f8457534e3135924b8f29fc0d3))
* **bridge:** real cross-platform PTY host, VT screen tap and agent status detector in C# ([425f6a3](https://github.com/gutzerk/code_chroma/commit/425f6a3ce37de90a146eb39f9967fda1361c45ef))
* **bridge:** resolve c1, epics, sequence, custom and feature-plan diagrams like the Python resolver ([d36c57e](https://github.com/gutzerk/code_chroma/commit/d36c57e8633e30d81e95d997f64f7ef9148deeaa))
* **bridge:** serve the graph from CodeChroma.Core with Python analyzers via analysis_export ([206049f](https://github.com/gutzerk/code_chroma/commit/206049fce4d6881569cd6feea71caeabbb3d2795))
* C# bridge and shell, distribution (stage → main) ([86d277a](https://github.com/gutzerk/code_chroma/commit/86d277ae8132a9bfbc8044746449c71672dd4ff7))
* Canvas style settings (background color and texture) ([32b072d](https://github.com/gutzerk/code_chroma/commit/32b072d51341b6150ff3b5e8fbaeeea83338bbec))
* **canvas:** agent window store, rail and floating windows with headless journeys ([2757d70](https://github.com/gutzerk/code_chroma/commit/2757d70a31efa3eee913d57d5b561dbed160f55e))
* **canvas:** Avalonia CanvasView (culled scene, pan/zoom, selection, collision-resolved drag) with headless journey tests ([ebd8bb2](https://github.com/gutzerk/code_chroma/commit/ebd8bb22e3d8f1ce031555c248763fba09533da3))
* **canvas:** canvas document model, element rules and node accents in C# ([83c11c3](https://github.com/gutzerk/code_chroma/commit/83c11c3a82bb79fc7f1282d4baf9a1ca82c840f6))
* **canvas:** Diff toggle with block recolor, change-card panels, diff popup and Accept ([fbfe7fb](https://github.com/gutzerk/code_chroma/commit/fbfe7fb85dd121aafe36abbd20563b517c71983f))
* **canvas:** hierarchy canvas, rubber-band select, group drag, undo and code popup in Avalonia ([9220106](https://github.com/gutzerk/code_chroma/commit/922010681b70af8cab5c90808faf39472cf3d3fb))
* **canvas:** hierarchy expand-in-place model, selection/undo/marquee logic and syntax tokenizer ([2d8afc1](https://github.com/gutzerk/code_chroma/commit/2d8afc11b37b9fb6176f17cd3fd9edce39d6ede8))
* **canvas:** native layered layout, epics/sequence/incremental layout in C# ([886d374](https://github.com/gutzerk/code_chroma/commit/886d374a9f87920b2a27dc255d4b930f49bc8f98))
* **canvas:** port orthogonal/obstacle routing, edge ports and drop solver to C# ([41ebc18](https://github.com/gutzerk/code_chroma/commit/41ebc1859c7a89197e2e222730c0f12ca59a0311))
* **canvas:** stores, diagram catalog/orchestrator and language registry in C# ([0fb6c82](https://github.com/gutzerk/code_chroma/commit/0fb6c823912f8c27e04d80dcd12bbcbe1d76004a))
* **canvas:** trace playback player, flow overlay and controls with headless journey tests ([f8aaf91](https://github.com/gutzerk/code_chroma/commit/f8aaf917b39ee3552cd9a91650662c294ec24db6))
* **canvas:** viewport matrix and model-owned scene graph with culling ([3523d22](https://github.com/gutzerk/code_chroma/commit/3523d22a4d13ff073497a0d16b5a3b752241fa7a))
* **desktop:** harden the in-app updater ([62ca5d4](https://github.com/gutzerk/code_chroma/commit/62ca5d484bae41d0b5d1218e5c660c8b843f463f))
* **distribution:** harden installers, single manifest generator and release pipeline ([9b61f48](https://github.com/gutzerk/code_chroma/commit/9b61f48f450b327ca2a400911494c43c7e80ecde))
* **distribution:** install.sh --dotnet and install.ps1 -Dotnet for the C# app, docs ([3bc487c](https://github.com/gutzerk/code_chroma/commit/3bc487ceac6b0ce5c7ab3cb727f518aeaf9049d7))
* **distribution:** Velopack packaging, dotnet manifest targets and gated release jobs ([505b96a](https://github.com/gutzerk/code_chroma/commit/505b96a9b3e19365c848bcb93730e557c8bf3d4b))
* **dotnet:** C# repo scanner, offline summaries and Python/TypeScript analyzers over tree-sitter ([73f6c2b](https://github.com/gutzerk/code_chroma/commit/73f6c2bbe5fcf4977dc70f6d090c4608e61ece97))
* **dotnet:** Go, Rust, Java, C#, PHP, Ruby, C, C++ and YAML analyzers ([db5d63c](https://github.com/gutzerk/code_chroma/commit/db5d63c70b868c0c147e3d7b9c88d08a850b46d9))
* implement the C# graph core until the parity tests pass ([fe18c2b](https://github.com/gutzerk/code_chroma/commit/fe18c2b6cbd0b3c258fd79a25c2865f6b39fbca9))
* **packaging:** ship app icons for macOS and Linux ([eedc620](https://github.com/gutzerk/code_chroma/commit/eedc620816cd35228952d42358dff4441970e112))
* remove Electron and ship only the C# app ([997d4ba](https://github.com/gutzerk/code_chroma/commit/997d4ba491bb91a9d4616287358e3da8890c5b53))
* **shell:** add Avalonia host skeleton and 011 planning doc ([bebd214](https://github.com/gutzerk/code_chroma/commit/bebd214ea9a7295b072e614fc8c5cb21001dca6d))
* **shell:** implement C# shell logic (tab model, bridge manager, updater, stores) ([be64690](https://github.com/gutzerk/code_chroma/commit/be64690f586446d44aa2151122b4aee74eb13622))
* **shell:** macOS native menu, Cmd shortcut hints, PNG window icon and cross-platform font stack (016) ([670abdd](https://github.com/gutzerk/code_chroma/commit/670abdd7e7458f09b86086f1af4423ed737135f1))
* **shell:** real update operations, platform swap helpers with rollback and Electron migration ([23176d2](https://github.com/gutzerk/code_chroma/commit/23176d2bcfa188a4592e1bfba032274084cbaa83))
* **shell:** restyle the launcher and tab strip like the Electron UI, drop the native menu bar for a ... menu (016) ([468bbf3](https://github.com/gutzerk/code_chroma/commit/468bbf3da5fa72bfc27ec49831ba706c2f7359ab))
* **shell:** ShellController open-repo flow, titles with version, About, tutorial project ([1f20435](https://github.com/gutzerk/code_chroma/commit/1f20435a883cfd60f43c74fd2f449c06a9bb915d))
* **shell:** use the real CodeChroma icon for the exe, window and Velopack shortcuts (016) ([9cb5faf](https://github.com/gutzerk/code_chroma/commit/9cb5faf7c6c0d80ee09be44f26859f6f7f59f8d7))
* **shell:** WebView per tab, tab bar, launcher, branch picker, About, window title with version ([d77ca29](https://github.com/gutzerk/code_chroma/commit/d77ca29e0bb7a322aaa2547513b0ddbc60972a58))
* **shell:** wire updater, Electron migration and checksum-only notice into the app ([21b0ec0](https://github.com/gutzerk/code_chroma/commit/21b0ec05a90d13df9d068d00191e7ee97a54cd48))
* steer a running workflow (stop, ask, redo) ([#146](https://github.com/gutzerk/code_chroma/issues/146)) ([e482a63](https://github.com/gutzerk/code_chroma/commit/e482a63bb614a62c52d9ec46de325958a0051ec0))
* version the Windows installer name (CodeChroma-&lt;version&gt;-x64-Setup.exe) ([bdca954](https://github.com/gutzerk/code_chroma/commit/bdca954cfaaa78a679c8241bc932bdcec70cdbc3))
* **web:** floating shell panels, right-docked agents panel and arrange selected ([2463403](https://github.com/gutzerk/code_chroma/commit/2463403fde5d862410c35c0159bf6d8b85697f05))
* **web:** floating shell redesign with right-docked agents panel and arrange selected ([19c17b5](https://github.com/gutzerk/code_chroma/commit/19c17b56bfe2ac3c27d64ad9055e443fef3c2350))
* **web:** left diagrams/files panel, collapsible agents bar and full-screen agent ([6e34424](https://github.com/gutzerk/code_chroma/commit/6e344248bae584ac0ac1bb9732135c2adf8803d0))
* **web:** shell store and edge handle foundation for the panel redesign ([8f358ca](https://github.com/gutzerk/code_chroma/commit/8f358ca5f4bcf8290d3b1e914a82e3661465c00c))


### Bug Fixes

* **canvas:** Avalonia canvas review fixes and UI-thread helper (013) ([7e747bc](https://github.com/gutzerk/code_chroma/commit/7e747bc0d4c2898dbc077ccc0828ac84fe1129cc))
* drop synced skill copies accidentally committed into the sample_repo fixture ([df7d246](https://github.com/gutzerk/code_chroma/commit/df7d24635dc97ac6d25e6a3bc095499f48798a19))
* **graph:** drop rows under a stale repository_id when saving a per-repo store ([71ffd53](https://github.com/gutzerk/code_chroma/commit/71ffd53c506c4af5657a2c4118deb72c5dc7fa7a))
* Python bridge/terminal and web canvas review fixes ([e022c2f](https://github.com/gutzerk/code_chroma/commit/e022c2f2e319fe4ec9c35b03ac3702defc145e4f))
* register the question waiter before the element is shown and keep questions in canvas core ([9032bd9](https://github.com/gutzerk/code_chroma/commit/9032bd952c528a5dbe0641f38fbf0d85e32ad69d))
* **shell:** centre the launcher vertically and round the tabs (016) ([137aa8d](https://github.com/gutzerk/code_chroma/commit/137aa8d220be8654f6d67eab7459b91b869d7b1b))
* **shell:** dark theme matching the original launcher palette ([f755fe3](https://github.com/gutzerk/code_chroma/commit/f755fe3da4b24efec715180949f1f9a23720c215))
* **shell:** stop macOS crash when sending scripts to the web view ([ac500a1](https://github.com/gutzerk/code_chroma/commit/ac500a1e5279585c6e98f1c73693d2414ef91d58))
* **shell:** Velopack hook, updater and installer review fixes (016) ([22cc882](https://github.com/gutzerk/code_chroma/commit/22cc8825fcc2c67bdcfb47f6fceaecf6f8c864b9))
* **terminal:** drain ConPTY output buffered after the child exits ([2454d59](https://github.com/gutzerk/code_chroma/commit/2454d59c8a2a0ce80d9ad34bc725b21caef707e8))
* **web:** address code-review findings on the shell redesign ([4363ac4](https://github.com/gutzerk/code_chroma/commit/4363ac424a6477b803720f4f18118b4a8c582be5))

## [0.12.1](https://github.com/gutzerk/code_chroma/compare/v0.12.0...v0.12.1) (2026-10-13)


### Bug Fixes

* bundle winpty in the frozen bridge so agent terminals render ([75c34e7](https://github.com/gutzerk/code_chroma/commit/75c34e7ebbb747446ed8e35aa4cf799a6e7e9012))
* harden branch workspaces, the origin guard and gh issue posting ([cf0ff42](https://github.com/gutzerk/code_chroma/commit/cf0ff4263c4c9f1ae1d36840a107ec92c2e4c9a2))
* point diagram node_id at the deepest symbol and flag one node_id shared across groups ([0e4d394](https://github.com/gutzerk/code_chroma/commit/0e4d394b7c34397eacb1aad25a3d7e4f6027c448)), closes [#65](https://github.com/gutzerk/code_chroma/issues/65)

## [0.12.0](https://github.com/gutzerk/code_chroma/compare/v0.11.0...v0.12.0) (2026-10-12)


### Features

* ask which branch to show when a project is opened again ([a0d06b0](https://github.com/gutzerk/code_chroma/commit/a0d06b0a430a983edf6f09704e1f1d0b616a01e4)), closes [#123](https://github.com/gutzerk/code_chroma/issues/123)
* create issues through gh when it is available ([ce99ae4](https://github.com/gutzerk/code_chroma/commit/ce99ae4062d90d739c8db4a321b46016065773d0))


### Bug Fixes

* answer ConPTY's startup query so the Windows agent window shows output ([705d73f](https://github.com/gutzerk/code_chroma/commit/705d73fa603aa5351ec3f623ba88ba2eccb48049))
* apply ELK layout to every diagram layer that arrives unplaced ([bd829c7](https://github.com/gutzerk/code_chroma/commit/bd829c70a8eede072c81836bc377ccd322c77b9b)), closes [#120](https://github.com/gutzerk/code_chroma/issues/120)
* clearer docked-agent tabs, click/shortcut to open the collapsed dock, wiki notice clear of Fit All ([af1de57](https://github.com/gutzerk/code_chroma/commit/af1de57580366a3638cdbfcaa329ed2d97c19de6))
* don't fail a completed macOS update when old bundle cleanup hits ENOTEMPTY ([a85716b](https://github.com/gutzerk/code_chroma/commit/a85716bbbd70dae1a650c8b091047a15d4390802)), closes [#118](https://github.com/gutzerk/code_chroma/issues/118)
* swap the macOS bundle after exit and install Windows updates silently ([12bfcd8](https://github.com/gutzerk/code_chroma/commit/12bfcd893de8a76c8ac3e75e81c934fda082293e))

## [0.11.0](https://github.com/gutzerk/code_chroma/compare/v0.10.0...v0.11.0) (2026-10-11)


### Features

* tag external components and add a standard shape registry to diagrams ([4f63a76](https://github.com/gutzerk/code_chroma/commit/4f63a76de5aaba425b7609c277adea7be95409e3)), closes [#63](https://github.com/gutzerk/code_chroma/issues/63)


### Bug Fixes

* add a copy-name button to the diagram frame label ([d3de2c1](https://github.com/gutzerk/code_chroma/commit/d3de2c1f68d4290fb2a752fba8a6fdcfd40907a6)), closes [#55](https://github.com/gutzerk/code_chroma/issues/55)
* keep overlapping diagram labels and open code panels readable ([454cd99](https://github.com/gutzerk/code_chroma/commit/454cd99ac49ae23a20500a6381f4e35f9f4d38c9)), closes [#54](https://github.com/gutzerk/code_chroma/issues/54)
* keep sequence arrows inside the frame and let stale recent projects be removed ([d7880e3](https://github.com/gutzerk/code_chroma/commit/d7880e3e485569e6b9b5436c9f38b53c8987ccd9))
* shorten docstring to satisfy ruff line length ([98d77e0](https://github.com/gutzerk/code_chroma/commit/98d77e03d65e0c621bb43ee0dd5668b8f5e77b8b))
* shrink the drag minimum gap so ELK-laid-out blocks can be dropped back ([fdc91fe](https://github.com/gutzerk/code_chroma/commit/fdc91fe98e63ea4f430b1ae59f4f5ae530fba8aa))

## [0.10.0](https://github.com/gutzerk/code_chroma/compare/v0.9.3...v0.10.0) (2026-10-10)


### Features

* lay out diagrams with ELK and keep placed blocks fixed on update ([aa0d195](https://github.com/gutzerk/code_chroma/commit/aa0d195b1085e08d363c1002fe5782c084fda7ba))

## [0.9.3](https://github.com/gutzerk/code_chroma/compare/v0.9.2...v0.9.3) (2026-10-10)


### Bug Fixes

* make recent repos and desktop tests work on Windows ([f1b770a](https://github.com/gutzerk/code_chroma/commit/f1b770a2d3ed2495a56c5351e27754d390c0596b))
* make the in-app updater verify signatures under Electron ([f795628](https://github.com/gutzerk/code_chroma/commit/f795628b63c71b60d0dd41d5ec8f83376a750bf9))

## [0.9.2](https://github.com/gutzerk/code_chroma/compare/v0.9.1...v0.9.2) (2026-10-09)


### Bug Fixes

* shorten _check_split docstring for ruff E501 ([ce1a0f5](https://github.com/gutzerk/code_chroma/commit/ce1a0f5f7a6ad5a2e4a27b4fd7fee4a34303e6a7))
* suggest splitting diagrams over ~15 nodes into several linked ones ([f9cfaa4](https://github.com/gutzerk/code_chroma/commit/f9cfaa442e0e9363689d482e4638bcbfbeec8b83)), closes [#99](https://github.com/gutzerk/code_chroma/issues/99)

## [0.9.1](https://github.com/gutzerk/code_chroma/compare/v0.9.0...v0.9.1) (2026-10-09)


### Bug Fixes

* shorten _check_split docstring for ruff E501 ([ce1a0f5](https://github.com/gutzerk/code_chroma/commit/ce1a0f5f7a6ad5a2e4a27b4fd7fee4a34303e6a7))
* suggest splitting diagrams over ~15 nodes into several linked ones ([f9cfaa4](https://github.com/gutzerk/code_chroma/commit/f9cfaa442e0e9363689d482e4638bcbfbeec8b83)), closes [#99](https://github.com/gutzerk/code_chroma/issues/99)

## [0.9.0](https://github.com/gutzerk/code_chroma/compare/v0.8.1...v0.9.0) (2026-10-06)


### Features

* add "New project…" to the desktop launcher ([#52](https://github.com/gutzerk/code_chroma/issues/52)) ([#97](https://github.com/gutzerk/code_chroma/issues/97)) ([dff8483](https://github.com/gutzerk/code_chroma/commit/dff8483f97fd4b8df2d5c32a0f74d9bcdd3b60e0))

## [0.8.1](https://github.com/gutzerk/code_chroma/compare/v0.8.0...v0.8.1) (2026-10-06)


### Bug Fixes

* don't open block details after a drag, stop diagram frame flicke… ([db02b97](https://github.com/gutzerk/code_chroma/commit/db02b97c20dc1722bb33c9465d176b6b896221f5))

## [0.8.0](https://github.com/gutzerk/code_chroma/compare/v0.7.1...v0.8.0) (2026-10-06)


### Features

* recolor run-agent icon, enlarge it, and fix its tooltip layering ([0979d94](https://github.com/gutzerk/code_chroma/commit/0979d94a10bd64db6f0e6797f02b2d740a2a7b44))
* show release changelog in Updates and move Report issue to the … ([e2a45b2](https://github.com/gutzerk/code_chroma/commit/e2a45b24135ea3293b590104f36acb8c16c35c98))
* show release changelog in Updates and move Report issue to the top bar ([309781f](https://github.com/gutzerk/code_chroma/commit/309781f9fc98b9874cde822f84603f9489805e4a))

## [0.7.1](https://github.com/gutzerk/code_chroma/compare/v0.7.0...v0.7.1) (2026-10-05)


### Bug Fixes

* make unit tests and git/encoding handling portable on Windows ([d4d7964](https://github.com/gutzerk/code_chroma/commit/d4d79645f63b3d45ede102c060761f5a94a74b28))

## [0.7.0](https://github.com/gutzerk/code_chroma/compare/v0.6.0...v0.7.0) (2026-10-05)


### Features

* open a project directly from GitHub (--github) and fix flaky git_long test ([fd0704a](https://github.com/gutzerk/code_chroma/commit/fd0704a39f0843925272b79da21717b3283d96ea))


### Bug Fixes

* harden --github ref handling and portable zombie check in test ([2fb4b31](https://github.com/gutzerk/code_chroma/commit/2fb4b313c05c95e39e1aaa124836a8b76793fac2))

## [0.6.0](https://github.com/gutzerk/code_chroma/compare/v0.5.1...v0.6.0) (2026-10-04)


### Features

* add Settings Updates with per-user installation flow ([ce3b126](https://github.com/gutzerk/code_chroma/commit/ce3b126463fd1c960c75d7239c4aae431ead0604))
* add Settings Updates with per-user installation flow ([34126e8](https://github.com/gutzerk/code_chroma/commit/34126e870882ab7d8b3f6d5569352b581839c45b))


### Bug Fixes

* isolate CLI runtime test fixtures ([76f7db3](https://github.com/gutzerk/code_chroma/commit/76f7db38b1458e6d1080327856466d65402a2ad3))
* isolate CLI runtime test fixtures ([e3db944](https://github.com/gutzerk/code_chroma/commit/e3db944b352ce72d57d2a19c9c10615b3387154d))

## [0.5.1](https://github.com/gutzerk/code_chroma/compare/v0.5.0...v0.5.1) (2026-10-04)


### Bug Fixes

* resolve GitHub repository for PR picker ([baa1d94](https://github.com/gutzerk/code_chroma/commit/baa1d94e471fe94a105e5446a0fcb2761781d4ce))
* resolve GitHub repository for PR picker ([a71c232](https://github.com/gutzerk/code_chroma/commit/a71c23296e1b1708a13650e448a9bfdfe4406d1b))
* synchronize watcher startup and update publish test stub ([ecfd7f8](https://github.com/gutzerk/code_chroma/commit/ecfd7f80812269d2615e9b7a6b7e029d9d246434))
* synchronize watcher startup and update publish test stub ([19103ce](https://github.com/gutzerk/code_chroma/commit/19103ce295a9302ceebe675ac22d2980b243d45e))

## [0.5.0](https://github.com/gutzerk/code_chroma/compare/v0.4.2...v0.5.0) (2026-10-04)


### Features

* load CodeChroma skills in agent sessions ([fcd6b45](https://github.com/gutzerk/code_chroma/commit/fcd6b458d203e97c622a0d9ead29cd7bfdfac528))


### Bug Fixes

* recover corrupt graph database caches ([0f86175](https://github.com/gutzerk/code_chroma/commit/0f8617508c9dab85005eb050b5e21af26d2d64fb))
* start desktop shell fullscreen ([e084e6f](https://github.com/gutzerk/code_chroma/commit/e084e6f61b8a7560e82d9ed61bf3df207af7616b))
* support wrapped Claude agent executables ([16ce542](https://github.com/gutzerk/code_chroma/commit/16ce5424fba8e2fed524e711e7bfe9f0918a1f4f))

## [0.4.2](https://github.com/gutzerk/code_chroma/compare/v0.4.1...v0.4.2) (2026-10-04)


### Bug Fixes

* restore Windows desktop window controls ([2ee6c8f](https://github.com/gutzerk/code_chroma/commit/2ee6c8f271e6296d4b2a26308c7a2f40759fdd97))
* restore Windows desktop window controls ([dd36006](https://github.com/gutzerk/code_chroma/commit/dd36006d83a795910a73cd8187af4265ae1efd46))

## [0.4.1](https://github.com/gutzerk/code_chroma/compare/v0.4.0...v0.4.1) (2026-10-04)


### Bug Fixes

* keep desktop Sigstore compatible with Electron runtime ([5c069fe](https://github.com/gutzerk/code_chroma/commit/5c069fe76618dcd5cb206f1bdad5e289991aa67d))
* keep desktop Sigstore compatible with Electron runtime ([de7b25e](https://github.com/gutzerk/code_chroma/commit/de7b25ee9893d82692004bc01295906414bbff82))

## [0.4.0](https://github.com/gutzerk/code_chroma/compare/v0.3.2...v0.4.0) (2026-10-04)


### Features

* dock agent terminals on canvas ([f669a72](https://github.com/gutzerk/code_chroma/commit/f669a726b6fa74397049cef00fcb46d259609d4c))
* dock agent terminals on canvas ([7d7ab27](https://github.com/gutzerk/code_chroma/commit/7d7ab273f09a2244ccd63f0c8ad863064500a0aa))

## [0.3.2](https://github.com/gutzerk/code_chroma/compare/v0.3.1...v0.3.2) (2026-10-04)


### Bug Fixes

* show agent launch errors in agent windows ([58de260](https://github.com/gutzerk/code_chroma/commit/58de2600a283385ea1d880f5208747458e7dc12c))

## [0.3.1](https://github.com/gutzerk/code_chroma/compare/v0.3.0...v0.3.1) (2026-10-04)


### Bug Fixes

* simplify stable Windows installer releases ([9b3c9cd](https://github.com/gutzerk/code_chroma/commit/9b3c9cd540b49662788a032fc0377dc97924f17c))

## [0.3.0](https://github.com/gutzerk/code_chroma/compare/v0.2.2...v0.3.0) (2026-10-03)


### Features

* add production install scripts ([5014f14](https://github.com/gutzerk/code_chroma/commit/5014f14e8367471778e61405dbd08ed9bd6a3309))
* add production install scripts ([6b8c92e](https://github.com/gutzerk/code_chroma/commit/6b8c92eb3df4abc2d63bdeff4fa746b7cdbca506))


### Bug Fixes

* add release-please manifest configuration ([406456a](https://github.com/gutzerk/code_chroma/commit/406456a15a85abd1c1828b8d593e2534333479a1))
* add release-please manifest configuration ([37c7879](https://github.com/gutzerk/code_chroma/commit/37c7879e7904bdfe0ded2b6cbd64be0a147a40cb))
* correct Windows bridge packaging and refresh desktop icon ([55b5729](https://github.com/gutzerk/code_chroma/commit/55b57292068f78fe2eef283f5c02e08798195e8e))
* correct Windows bridge packaging and refresh desktop icon ([304fc23](https://github.com/gutzerk/code_chroma/commit/304fc23c458d9c87c9873f02f4e023bdbda89467))
* **desktop:** add Linux package metadata ([5a9ecc8](https://github.com/gutzerk/code_chroma/commit/5a9ecc83d1c065cde6282a7c8511fdcd5ad8d681))
* **desktop:** add Linux package metadata ([15dc854](https://github.com/gutzerk/code_chroma/commit/15dc854fddf145dbb15712576c9822bf61a32f7b))
* **desktop:** align Linux artifact naming ([f37eed2](https://github.com/gutzerk/code_chroma/commit/f37eed258c03bce8b95ec98192f06789472ff77d))
* **desktop:** align Linux artifact naming ([38d8868](https://github.com/gutzerk/code_chroma/commit/38d886897e846177e5360805b96d5aef165c9b0b))
* publish Intel macOS desktop installer ([55a15a8](https://github.com/gutzerk/code_chroma/commit/55a15a8e35b5e2d2bd0495428836bfc9d20741f7))
* publish Intel macOS desktop installer ([a531c1f](https://github.com/gutzerk/code_chroma/commit/a531c1fe17d34e4dad91801b17289fd6001589a8))
* **release:** create manifest output directory ([068cd90](https://github.com/gutzerk/code_chroma/commit/068cd90c708f850f47989ca42d2a673efb43e69a))
* **release:** create manifest output directory ([a492b23](https://github.com/gutzerk/code_chroma/commit/a492b2336dbf479e66717dbd586ba97b9701b855))
* use release PAT secret ([34824d5](https://github.com/gutzerk/code_chroma/commit/34824d589117400ad20b9429d44671c96950d257))

## [0.2.2](https://github.com/gutzerk/code_chroma/compare/codechroma-v0.2.1...codechroma-v0.2.2) (2026-10-03)


### Bug Fixes

* **release:** create manifest output directory ([068cd90](https://github.com/gutzerk/code_chroma/commit/068cd90c708f850f47989ca42d2a673efb43e69a))
* **release:** create manifest output directory ([a492b23](https://github.com/gutzerk/code_chroma/commit/a492b2336dbf479e66717dbd586ba97b9701b855))

## [0.2.1](https://github.com/gutzerk/code_chroma/compare/codechroma-v0.2.0...codechroma-v0.2.1) (2026-10-03)


### Bug Fixes

* correct Windows bridge packaging and refresh desktop icon ([55b5729](https://github.com/gutzerk/code_chroma/commit/55b57292068f78fe2eef283f5c02e08798195e8e))
* correct Windows bridge packaging and refresh desktop icon ([304fc23](https://github.com/gutzerk/code_chroma/commit/304fc23c458d9c87c9873f02f4e023bdbda89467))

## [0.2.0](https://github.com/gutzerk/code_chroma/compare/codechroma-v0.1.3...codechroma-v0.2.0) (2026-10-03)


### Features

* add production install scripts ([5014f14](https://github.com/gutzerk/code_chroma/commit/5014f14e8367471778e61405dbd08ed9bd6a3309))
* add production install scripts ([6b8c92e](https://github.com/gutzerk/code_chroma/commit/6b8c92eb3df4abc2d63bdeff4fa746b7cdbca506))


### Bug Fixes

* **desktop:** align Linux artifact naming ([f37eed2](https://github.com/gutzerk/code_chroma/commit/f37eed258c03bce8b95ec98192f06789472ff77d))
* **desktop:** align Linux artifact naming ([38d8868](https://github.com/gutzerk/code_chroma/commit/38d886897e846177e5360805b96d5aef165c9b0b))

## [0.1.3](https://github.com/gutzerk/code_chroma/compare/codechroma-v0.1.2...codechroma-v0.1.3) (2026-10-03)


### Bug Fixes

* **desktop:** add Linux package metadata ([5a9ecc8](https://github.com/gutzerk/code_chroma/commit/5a9ecc83d1c065cde6282a7c8511fdcd5ad8d681))
* **desktop:** add Linux package metadata ([15dc854](https://github.com/gutzerk/code_chroma/commit/15dc854fddf145dbb15712576c9822bf61a32f7b))

## [0.1.2](https://github.com/gutzerk/code_chroma/compare/codechroma-v0.1.1...codechroma-v0.1.2) (2026-10-03)


### Bug Fixes

* publish Intel macOS desktop installer ([55a15a8](https://github.com/gutzerk/code_chroma/commit/55a15a8e35b5e2d2bd0495428836bfc9d20741f7))
* publish Intel macOS desktop installer ([a531c1f](https://github.com/gutzerk/code_chroma/commit/a531c1fe17d34e4dad91801b17289fd6001589a8))

## [0.1.1](https://github.com/gutzerk/code_chroma/compare/codechroma-v0.1.0...codechroma-v0.1.1) (2026-10-03)


### Bug Fixes

* add release-please manifest configuration ([406456a](https://github.com/gutzerk/code_chroma/commit/406456a15a85abd1c1828b8d593e2534333479a1))
* add release-please manifest configuration ([37c7879](https://github.com/gutzerk/code_chroma/commit/37c7879e7904bdfe0ded2b6cbd64be0a147a40cb))
* use release PAT secret ([34824d5](https://github.com/gutzerk/code_chroma/commit/34824d589117400ad20b9429d44671c96950d257))
