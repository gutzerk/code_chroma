# Changelog

## [1.11.0](https://github.com/gutzerk/code_chroma/compare/v1.10.0...v1.11.0) (2026-10-30)


### Features

* **web:** restyle agent questions and put the question above the terminal ([35b229b](https://github.com/gutzerk/code_chroma/commit/35b229b6a74f994f6907b93f5df3bdd540381824))
* **web:** switch agents with Ctrl/Cmd+Alt+Up/Down ([#334](https://github.com/gutzerk/code_chroma/issues/334)) ([b5506e3](https://github.com/gutzerk/code_chroma/commit/b5506e31ad7fcfa676dd8594062ccfedb94aa3fc))


### Bug Fixes

* **web:** keep orphaned agent questions on the canvas and fix review issues ([011844a](https://github.com/gutzerk/code_chroma/commit/011844a087c581b1870abf1be1d7ad58886a46e7))

## [1.10.0](https://github.com/gutzerk/code_chroma/compare/v1.9.0...v1.10.0) (2026-10-30)


### Features

* add the walkthrough diagram type and the B2 look for routes ([9c94251](https://github.com/gutzerk/code_chroma/commit/9c94251d73e677197e003c55b764f1ef7a54b490))
* **bridge:** carry a diagram's title onto the canvas and the status route ([b1c8113](https://github.com/gutzerk/code_chroma/commit/b1c81135836f1fe5c23ce3d6db963890fd9faa2f))
* canvas design batch — walkthrough B2, sequence A4, diagram titles, layout spacing, question wake-up ([4c5fd14](https://github.com/gutzerk/code_chroma/commit/4c5fd144b1b3e83d2f6194e36d5ac31bfab16488))
* **canvas:** show a diagram's title on its frame and ON CANVAS row ([5255010](https://github.com/gutzerk/code_chroma/commit/525501054afeff6e00f24086161bad97ca90b8ae))
* **layout:** measure box sizes before ELK, add meta.rank and feedback edges as layout hints ([252d35e](https://github.com/gutzerk/code_chroma/commit/252d35ebdd995b73ec0469d1b9283d2faecf4b48))
* rename C1 to System context and detect its environment like Design patterns ([370c061](https://github.com/gutzerk/code_chroma/commit/370c0612cecb60235b7cbcd7e801c1cfb9d0f9e9))
* **skills:** have the drawing agent title every diagram ([219faf4](https://github.com/gutzerk/code_chroma/commit/219faf426a3223ce11c182476e3867e9bc6888f2))
* **web:** draw the sequence diagram as the A4 glance board that expands a step in place ([f32b4e9](https://github.com/gutzerk/code_chroma/commit/f32b4e9fceb2edc99cdfef2a3682f940878c3e88))


### Bug Fixes

* **bridge:** message a step agent by resuming its session, find a run's worktree in its own workspace, keep restart answers on renamed inputs ([b544d6e](https://github.com/gutzerk/code_chroma/commit/b544d6eb6d643545b56c0f7129a8ae4f1d30108e))
* **bridge:** pass the assigned model to agent windows and list only claude aliases ([4def11b](https://github.com/gutzerk/code_chroma/commit/4def11b82851554e13f6769b99bb26e0d43a0120))
* **canvas:** reserve real role-box height and wider gaps in auto-layout ([9e10663](https://github.com/gutzerk/code_chroma/commit/9e10663d0977cca902483e6b966511bc2895f1e6))
* **checker:** exempt the system root from ARTICULATION, utf-8 output, exact-id UNREVIEWED hint, finish c1 rename in tests ([1af703d](https://github.com/gutzerk/code_chroma/commit/1af703dbf1189e1afb5936889be8a851a6590e05))
* **ci:** use the system-context layer in the canvas delete tests ([5a40854](https://github.com/gutzerk/code_chroma/commit/5a40854a9b00d7167b9144c9350b6e0ab1781c37))
* **ci:** wrap long lines, serve walkthrough in the wire fixture, use diagram tokens in CSS, finish c1 rename in tests ([36cc6ef](https://github.com/gutzerk/code_chroma/commit/36cc6ef730fa52a24a53b64ef0927600d03bb5dd))
* **questions:** clear an answered batch only after the agent really received it ([e2a5a52](https://github.com/gutzerk/code_chroma/commit/e2a5a52a99693fe4df751c493d5577653df1e7ce))
* **questions:** never strand an answered batch and type it as it stands at idle ([f05b651](https://github.com/gutzerk/code_chroma/commit/f05b651ae24e028a845c8bda1f30dcab7261d00f))
* **questions:** wake the asking agent once its batch is answered and clear the cards ([6f044f2](https://github.com/gutzerk/code_chroma/commit/6f044f2e88d606dbe97af40c9bef589ba5aaf3bd))
* **tests:** finish the C1 to system-context rename and register walkthrough in the Python tests ([62b2b1a](https://github.com/gutzerk/code_chroma/commit/62b2b1abca29ba0d55e4719245af84df37e56d8a))
* **tests:** finish the system-context rename in the agents, PR boot and context-envelope tests ([06f12ac](https://github.com/gutzerk/code_chroma/commit/06f12ac9a1f8711a04991eecd82599815b446252))
* **tests:** repair the walkthrough entry in the diagrams status test ([4fb8367](https://github.com/gutzerk/code_chroma/commit/4fb8367d120788a6d2630cc7d49970d5dda72eeb))
* **tests:** use the system-context routes and status key in the remaining bridge tests ([c38b9eb](https://github.com/gutzerk/code_chroma/commit/c38b9ebb0feb235d9117d7afcaba2236668a5d23))
* **tests:** wrap the lines the system-context rename pushed past 100 columns ([65d8dad](https://github.com/gutzerk/code_chroma/commit/65d8dad7653dd301c074164db9c1bf40664d4609))
* **web:** diagram box copy top-right, SRC bottom-right, no details button or popups ([bc31a87](https://github.com/gutzerk/code_chroma/commit/bc31a877f4f592f440a62c7499a2c6e7dd98133a))
* **web:** draw the walkthrough ROUTE panel inside the diagram with the B2 board look ([b6d0746](https://github.com/gutzerk/code_chroma/commit/b6d074663ce4d24786fcf489129bf70ec222911d))
* **web:** give walkthrough boxes the common box internals and fill boxes with their name when zoomed out ([2b731da](https://github.com/gutzerk/code_chroma/commit/2b731daff12d25eb255dd3e3b03ff1acab5de8cf))
* **web:** make sequence role colours clearly distinct (blue route, stronger tints) ([492a11c](https://github.com/gutzerk/code_chroma/commit/492a11cb8d877454c909e158099ab6227c7ccf7c))
* **web:** make sequence steps keyboard-safe and keep canvas caches fresh after review ([1450cc9](https://github.com/gutzerk/code_chroma/commit/1450cc9611d9e5e8e11b6c51582fd0294a9366e2))
* **web:** restore the group frame open arrow that was saved as mojibake ([2ac5ee8](https://github.com/gutzerk/code_chroma/commit/2ac5ee89ccc4930f984e369394fa1d57d425b265))
* **web:** share one role palette across boards and pin lane-tint ties ([e9ff11f](https://github.com/gutzerk/code_chroma/commit/e9ff11f0a2757c1e98ba0cfaec1405255cc0fbd4))
* **web:** snap agents panel to full near its widest and let the grip leave full ([c884a72](https://github.com/gutzerk/code_chroma/commit/c884a72851cab23b83738a411e146b313789237d))
* **web:** tint each sequence lane by the role of its steps ([40d5c9b](https://github.com/gutzerk/code_chroma/commit/40d5c9be848638a866d803890cdabd6743af9222))
* **web:** tint sequence step backgrounds by role so steps read apart ([0bfd258](https://github.com/gutzerk/code_chroma/commit/0bfd258f8d883d46c1b22eed8539121acf248396))
* **web:** use one zoomed-out name size per diagram so every box reads the same ([a0b746d](https://github.com/gutzerk/code_chroma/commit/a0b746d24aca8a50a7fbc15b4afeee3188787403))
* **web:** workflow editor slash skills, run view fixes and no embedded step terminal ([355c49f](https://github.com/gutzerk/code_chroma/commit/355c49fecd7f353374c7f2d3d87a4bc2c53e9642))

## [1.9.0](https://github.com/gutzerk/code_chroma/compare/v1.8.0...v1.9.0) (2026-10-28)


### Features

* **bridge:** carry a diagram route into node meta in both bridges ([1bc6e22](https://github.com/gutzerk/code_chroma/commit/1bc6e2247e6ec544689604cdf6a0193dd4afec34))
* **bridge:** pass sequence message kind and failure through to element meta ([814f07d](https://github.com/gutzerk/code_chroma/commit/814f07dae2b2c243328a8ec6b280970fdd74faff))
* **bridge:** surface edge/message-kind advisories as diagnostics; group arrow opens source ([1b14df7](https://github.com/gutzerk/code_chroma/commit/1b14df724b15efbc31c57085b576c23c3bd97b87))
* **llm:** probe the gemini CLI for its model list ([29ad4bf](https://github.com/gutzerk/code_chroma/commit/29ad4bffb36f18651f3c56a612b14ca03f307b1e))
* resolve route node_ids, route picker, Failures band and route e2e journeys ([ed76207](https://github.com/gutzerk/code_chroma/commit/ed76207f5e32f7da3ac4bf750e87e5aa504bf291))
* **skills:** author spawns/data edge kinds and advise on them in the self-check ([3ea586f](https://github.com/gutzerk/code_chroma/commit/3ea586fdd5d3446d4699ccb98556ada2540ce3b4))
* store a diagram route once on a carrier element ([45cd789](https://github.com/gutzerk/code_chroma/commit/45cd78974a022da09f829991470edbdb57bd1ee4))
* store a diagram route once on a carrier element instead of on every node ([37313f0](https://github.com/gutzerk/code_chroma/commit/37313f05ffa6af5e25a0b1ea5b8a8a3a52455fbb))
* **web:** add Chat about it button to the question card ([559c69c](https://github.com/gutzerk/code_chroma/commit/559c69c86fa4175d2c9dddda9040a9c683245cdf))
* **web:** add Chat about it button to the question card ([651d21b](https://github.com/gutzerk/code_chroma/commit/651d21bfd714a58cc77dd2dcf29a932e327f2a5d))
* **web:** apply the diagram readability board styles (022) ([85d591d](https://github.com/gutzerk/code_chroma/commit/85d591ddf51c15ccc08b3ecfe9f05c23d55889d5))
* **web:** board role styles for diagram blocks (role word, per-role frame and fill) ([191dbf0](https://github.com/gutzerk/code_chroma/commit/191dbf0bafdc7d054298ee0c571ef0f6c9580fb0))
* **web:** board-style typed edges, groups and focus panel ([fe85a46](https://github.com/gutzerk/code_chroma/commit/fe85a4684f608290a1b6ba2ca08bd58ff0cdffab))
* **web:** expand a route step in place into its calls ([ee8648b](https://github.com/gutzerk/code_chroma/commit/ee8648b90cd93fe7c4c12f4cf0eff09416580974))
* **web:** match the Impact view to the ImpactGlance design board ([3214a81](https://github.com/gutzerk/code_chroma/commit/3214a81fd39456e185ce78609bd50c0dd2dae340))
* **web:** members chip, hero card and zoom levels on canvas blocks ([a6f24a8](https://github.com/gutzerk/code_chroma/commit/a6f24a8072598f246b00a89af4a913b58fdcb058))
* **web:** pin Impact board bars to the diagram, merge minor pills, render removed links ([5dc1c55](https://github.com/gutzerk/code_chroma/commit/5dc1c559fecfa7221d65042236e14d2863319a09))
* **web:** redesign AI models settings around one default model ([265c0b8](https://github.com/gutzerk/code_chroma/commit/265c0b8e3ef5a8aebd8c3d077507a29ddce6f249))
* **web:** redesign AI models settings around one default model ([ca845e1](https://github.com/gutzerk/code_chroma/commit/ca845e19a8776991c32f1235b3ef7a3102cb1334))
* **web:** sequence focus timeline with phase bar, participants list and focus counts ([7657b9e](https://github.com/gutzerk/code_chroma/commit/7657b9e5668fa76db87f0c88a2b74cffe535aaff))
* **web:** sequence focus timeline/legend parity, board edge pills and group bundles ([19e0f1f](https://github.com/gutzerk/code_chroma/commit/19e0f1f08f6a8b0edbb5514e5584a337d692d725))
* **web:** show an authored route over the code map ([399fa0a](https://github.com/gutzerk/code_chroma/commit/399fa0ac3731063cf3df029d45c3bd99a718d5c0))


### Bug Fixes

* address PR review findings and CI lint failures ([ceb88a7](https://github.com/gutzerk/code_chroma/commit/ceb88a78d7c678d4102787db283c557264542350))
* address PR review findings on line counts and drawing hints ([1f63453](https://github.com/gutzerk/code_chroma/commit/1f6345386eda3df5c2ad596e4a1f3ad79e77ec01))
* address review findings on the single route carrier ([e5a29fc](https://github.com/gutzerk/code_chroma/commit/e5a29fcbca6e1e856c5a58245dddf8da9fd23d0a))
* **bridge:** isolate and cache the live CLI model probe, pick models without "default" ([4e80092](https://github.com/gutzerk/code_chroma/commit/4e80092362b2f2a13a4d000c48df56737b94c652))
* **llm-settings:** address review findings on the models tab ([c646cce](https://github.com/gutzerk/code_chroma/commit/c646ccebbd28837d104e8d5975cf2c2cb49c4a9f))
* **llm:** harden CLI model probes from review ([5c23c34](https://github.com/gutzerk/code_chroma/commit/5c23c34a9d7274fc01640891c9fa7246066f64bc))
* **llm:** list CLI models live and add a gemini CLI adapter ([ce6ca49](https://github.com/gutzerk/code_chroma/commit/ce6ca492072e25091151d9b14a8ea75db216a483))
* **llm:** list CLI models live and add a gemini CLI adapter ([2d40344](https://github.com/gutzerk/code_chroma/commit/2d403440ddd5ed2455f5911554e6fd039a935418)), closes [#297](https://github.com/gutzerk/code_chroma/issues/297)
* **llm:** pin the gemini probe command and shapes in a shared case, close probe stdin ([4223fd9](https://github.com/gutzerk/code_chroma/commit/4223fd9c04afe3e9ab59a218d7d8ef94d3d4dcd2))
* stamp lane_kind normal, harden lane parsing and wrap long test line ([74e195f](https://github.com/gutzerk/code_chroma/commit/74e195f6fe091957542f82dfa61fdd44b18528dd))
* **web:** keep diagram boxes out of the route highlight and move the ROUTE card clear of the agents panel ([44d9768](https://github.com/gutzerk/code_chroma/commit/44d97689cbffb1ada4ece5774d7da78b7f5aa5eb))
* **web:** let ai and event sequence arrows keep their own colour ([65f7590](https://github.com/gutzerk/code_chroma/commit/65f759088b953bedd9ec68ab767c0c87e6f7ed46))

## [1.8.0](https://github.com/gutzerk/code_chroma/compare/v1.7.1...v1.8.0) (2026-10-27)


### Features

* **bridge:** worktree tabs replace the branch switcher and per-agent worktrees ([7e435ff](https://github.com/gutzerk/code_chroma/commit/7e435ff645681e020deb52fe83dc5f54d7e0b6c5))
* **bridge:** worktree tabs replace the branch switcher and per-agent worktrees ([e5068e9](https://github.com/gutzerk/code_chroma/commit/e5068e98d474855b3426bc149a06b91ddaf70d60))
* **draw:** Draw dialog with type cards and a request, carried through both bridges ([5366f7b](https://github.com/gutzerk/code_chroma/commit/5366f7bc27dbc2a03553cc2416c60c6b487b80d1))
* **skills:** add system-context and dataflow diagram types ([72676cd](https://github.com/gutzerk/code_chroma/commit/72676cdb961b0bd1ad3803f1a650e9339d65ace2))
* **skills:** add system-context and dataflow diagram types to the draw-diagram skill ([160d284](https://github.com/gutzerk/code_chroma/commit/160d28427d493149b3e8ffda5ead0fa8b89664b3))
* **web:** confirm a successful diagram export with a short notice ([594497b](https://github.com/gutzerk/code_chroma/commit/594497bff62e9d469917d5a0693eadef5e4dc22b))
* **web:** export selected diagrams from the Diagrams panel ([f021c34](https://github.com/gutzerk/code_chroma/commit/f021c342dbf924d6abb518ab92e2e42f343f45f3))
* **web:** move diagram export into the Diagrams panel and export only selected diagrams ([6d60c93](https://github.com/gutzerk/code_chroma/commit/6d60c937d9ad100f3028dc19be19da61a9d45cb1))
* **workflows:** park a step as needs_you when its agent reports blocked or question ([f60cda0](https://github.com/gutzerk/code_chroma/commit/f60cda06ce57637715cac5781988645406d66ede)), closes [#290](https://github.com/gutzerk/code_chroma/issues/290)


### Bug Fixes

* **bridge:** address worktree-tab review findings ([0cba9a4](https://github.com/gutzerk/code_chroma/commit/0cba9a4b1617f2cbeec50e5cadb98e79e15a6ba1))
* **bridge:** agents and terminal see the login-shell environment ([9eb9e90](https://github.com/gutzerk/code_chroma/commit/9eb9e9096f4b60901aa8e413fb1668998056d441))
* **bridge:** bound the login-shell wait and keep codechroma_* in agent/terminal PTY env ([e6f7554](https://github.com/gutzerk/code_chroma/commit/e6f755480a1979a73535bf8e84f6379341b6c841))
* **bridge:** start agent and terminal PTYs with the login-shell environment ([a823b28](https://github.com/gutzerk/code_chroma/commit/a823b2825914576ba7b6647b1060bc015f87893a)), closes [#294](https://github.com/gutzerk/code_chroma/issues/294)
* **draw:** reapply Draw dialog pieces after merging main, restore _diagram_hint ([9a0071e](https://github.com/gutzerk/code_chroma/commit/9a0071e64b325f0e1bea84632f6d8fabc91ea7ec))
* open the inspector only from the SRC button, layer panels correctly, notify about updates only at startup ([9908222](https://github.com/gutzerk/code_chroma/commit/990822206d55ec6e1b0aff9c7392b6ce944a19eb))
* **questions:** address review findings on diagram zoom, delivery and draft layers ([64171bc](https://github.com/gutzerk/code_chroma/commit/64171bc5a09ac31629eba0dfa98a21d190492599))
* **questions:** non-blocking ask, C# questions port, real option diagrams ([1a771f2](https://github.com/gutzerk/code_chroma/commit/1a771f28f7591d9dcd8faa3b6e677c8f34012653))
* **questions:** non-blocking ask, C# questions port, real option diagrams ([4082ace](https://github.com/gutzerk/code_chroma/commit/4082ace899a82ecf7c2da8ac737b2028056d6772))
* **questions:** share one MCP instructions text between the Python and C# bridges ([21c0016](https://github.com/gutzerk/code_chroma/commit/21c001629e592183a85809587469cf5f77e54767))
* render sequence diagram return arrows and labels correctly ([b50f195](https://github.com/gutzerk/code_chroma/commit/b50f195b5f88b34ebcabcc08c278796b87947b7c)), closes [#276](https://github.com/gutzerk/code_chroma/issues/276)
* **skills:** ask non-sequence diagrams for question, summary and hero ([#277](https://github.com/gutzerk/code_chroma/issues/277)) ([a625504](https://github.com/gutzerk/code_chroma/commit/a625504ba3dd2a27cdebd9bea59c20ca1965b6bb))
* **skills:** ask non-sequence diagrams for question, summary and hero ([#277](https://github.com/gutzerk/code_chroma/issues/277)) ([b16342b](https://github.com/gutzerk/code_chroma/commit/b16342b33c23b2675b78ab5f497349503c353e46))
* **web:** anchor the focus panel to the left panel through its CSS variables ([cc6ca52](https://github.com/gutzerk/code_chroma/commit/cc6ca52c32a1a426a55f67f7f2b868ae92a48c42))
* **web:** keep question diagram arrowheads outside nodes ([a27b7a3](https://github.com/gutzerk/code_chroma/commit/a27b7a3ebc136abfde6a12aebc42643ff11fecb1))
* **web:** make question option diagrams readable, pannable and zoomable ([9909a05](https://github.com/gutzerk/code_chroma/commit/9909a05eda5ba780634a98c7c77be3b5a0c913ce))
* **web:** use font and radius tokens in the Draw dialog css (stylelint) ([e452578](https://github.com/gutzerk/code_chroma/commit/e4525780f5aca5d5225277121f6612adde61a7de))
* **web:** warm up the snapshot render on WebKit so macOS exports are not blank ([060cf38](https://github.com/gutzerk/code_chroma/commit/060cf382a8a605ed16bb6374207327fb338b7e51))
* **wiki:** drop a leftover update manifest snapshot when a new generate starts ([b3880d9](https://github.com/gutzerk/code_chroma/commit/b3880d98fbfcb309097f994b6c805606ab5d5e24))
* **wiki:** drop a leftover update manifest snapshot when a new generate starts ([865802c](https://github.com/gutzerk/code_chroma/commit/865802c21b9690f76ffb720818aa321ded1a8295))
* **wiki:** track both wikis against main only, one shared copy across tabs ([2b89202](https://github.com/gutzerk/code_chroma/commit/2b8920232ed6887594d290ac1e28c23ff6f3ead5))
* **wiki:** track both wikis against main only, share one copy across tabs, restore manifest after a failed update ([1b5b44b](https://github.com/gutzerk/code_chroma/commit/1b5b44b79a69d7ea229cab7b916002f4333e870e))
* **workflows:** pass the agent result between steps, show it on review steps, name the step model, reveal saved runs on start ([96ca1e0](https://github.com/gutzerk/code_chroma/commit/96ca1e0cf296e44c32999de31707dffbf8c9636e))
* **workflows:** preserve Markdown in step hand-off results ([4b50060](https://github.com/gutzerk/code_chroma/commit/4b50060b327dddb836a940f6a3a5ff7f64da5b2d))
* **workflows:** show step agent start errors, honour agent capacity and hide legacy step chat messages ([e355ff0](https://github.com/gutzerk/code_chroma/commit/e355ff0dbf57caa0621204ee5af72b0fdef78ba7))
* **workflows:** talk to a finished step's agent in a real terminal ([01438f9](https://github.com/gutzerk/code_chroma/commit/01438f984749d791c2c6e198a9d7141ba0ee1e0c))
* **workflows:** talk to a finished step's agent in a real terminal instead of the one-shot send chat ([e726b8d](https://github.com/gutzerk/code_chroma/commit/e726b8de3dd8f796399e3ae96f64181958075cce)), closes [#292](https://github.com/gutzerk/code_chroma/issues/292)

## [1.7.1](https://github.com/gutzerk/code_chroma/compare/v1.7.0...v1.7.1) (2026-10-26)


### Bug Fixes

* activity full-screen overlap and macOS clipboard shortcuts ([efef67e](https://github.com/gutzerk/code_chroma/commit/efef67ee8b42ad7970451cda7db59588e00f6273))
* harden desktop clipboard shortcuts and terminal copy-on-select ([f5b0132](https://github.com/gutzerk/code_chroma/commit/f5b0132afba58602b902404cc40a78ac0c76d839))
* prevent activity tab overlap and use native desktop clipboard ([232cf7b](https://github.com/gutzerk/code_chroma/commit/232cf7b07465720352f117b1c67defd1fb7778ed))

## [1.7.0](https://github.com/gutzerk/code_chroma/compare/v1.6.1...v1.7.0) (2026-10-26)


### Features

* ask what to draw in the agent terminal instead of a type popover ([0a6d076](https://github.com/gutzerk/code_chroma/commit/0a6d076fe6714fba344d4f45251d76ddb0ab1fde))
* **bridge:** bootstrap the c1 draft and patterns diagrams when a workspace first opens ([dd5159f](https://github.com/gutzerk/code_chroma/commit/dd5159febcf5e9c89deac34ee80b535a5f268af5))
* **bridge:** close small C# bridge parity gaps with the Python bridge ([3d42b22](https://github.com/gutzerk/code_chroma/commit/3d42b22180b6a57d8440add5476796782949d698))
* **bridge:** emit impact-changes, wiki-general and custom/feature-plan+canvas watcher events ([2b08ee7](https://github.com/gutzerk/code_chroma/commit/2b08ee706d4be59a8c4dd37d236232c3120d8af7))
* **bridge:** port agent questions (ask_user, /mcp, questions routes) to the C# bridge ([9a5008b](https://github.com/gutzerk/code_chroma/commit/9a5008b2908a95cebd2249e7d36ee7ac47b5f9ba))
* **bridge:** port the AskUserQuestion PreToolUse hook to the C# bridge binary ([2e7c028](https://github.com/gutzerk/code_chroma/commit/2e7c028d17a212e9d3410ab439d270e07b5a91ce))
* **bridge:** read C1 through the borrowed source root for PR and agent workspaces ([dfda100](https://github.com/gutzerk/code_chroma/commit/dfda1000d55349fdf3b9422da076b46d712b43a1))
* **bridge:** serve dependency-digest, context-digest and route from the C# bridge ([f1ca691](https://github.com/gutzerk/code_chroma/commit/f1ca691c88da759b7e564e5717d925f415059ab0))
* **bridge:** write dependency-digest.json on analyze/reanalyze and fingerprint it like Python ([cd3d016](https://github.com/gutzerk/code_chroma/commit/cd3d0169b2a446338717ba285449367d6ff9b255))
* diagram readability - sequence Readable/Focus modes, block anatomy, impact glance ([d5d7f95](https://github.com/gutzerk/code_chroma/commit/d5d7f95ad6583de9562e2763fe72e19b54171cfc))
* **llm:** default model with capability-aware resolution and /llm/default, /llm/features routes ([23460d9](https://github.com/gutzerk/code_chroma/commit/23460d907617386da803e27daf9c9342bbe853f7))
* Share menu to export the canvas as PNG, HTML or PDF ([cb7a554](https://github.com/gutzerk/code_chroma/commit/cb7a554c73dec009fe472e0d4ce1d3103ea62818))
* **shell:** clone remote repositories from the launcher ([6338fc8](https://github.com/gutzerk/code_chroma/commit/6338fc86199bbb1f4ba91eda203998567a966481))


### Bug Fixes

* address PR [#265](https://github.com/gutzerk/code_chroma/issues/265) review findings ([f9cefb0](https://github.com/gutzerk/code_chroma/commit/f9cefb05a44816cdafa4a191f8dc6120507b5e7f))
* address PR review findings (export, sequence view, MCP config perms) ([6848ff0](https://github.com/gutzerk/code_chroma/commit/6848ff0a63229a935de933c6089fb01a165f9271))
* address review findings on diagram readability ([f5446f6](https://github.com/gutzerk/code_chroma/commit/f5446f6e80e265ab61cb0b2a74bb53c5c564d16d))
* address review findings on diagram readability ([aee97d1](https://github.com/gutzerk/code_chroma/commit/aee97d1ce10a8668722c961125d3788079c7308a))
* **bridge:** address PR review findings on bootstrap, hook, watchers and C1 matching ([6eef74d](https://github.com/gutzerk/code_chroma/commit/6eef74d9d4111270631821acbf13798e8ba42b26))
* **bridge:** initialize resumed agents after listening and serialize question decisions ([17c2ba8](https://github.com/gutzerk/code_chroma/commit/17c2ba87edc4f57393bb2490686d79603904dd51))
* **bridge:** read borrowed C1 from its source root and hash the digest like Python json.dumps ([2bbb146](https://github.com/gutzerk/code_chroma/commit/2bbb1468044f130764ea2f136dbbab39435f73d5))
* **bridge:** recheck projection.json when its directory is created after the watcher missed the write ([6019d02](https://github.com/gutzerk/code_chroma/commit/6019d02951d2b71b24286e0a45efc4de85167896))
* **bridge:** serialize diagram reasks and scope cached results ([d61ce3a](https://github.com/gutzerk/code_chroma/commit/d61ce3a6bac071ebf5e740b484eb3c0b613fc7e6))
* **canvas:** improve terminal controls and agent switching ([650233b](https://github.com/gutzerk/code_chroma/commit/650233bf4cbf05d9d90529e43c39338c7afba441))
* keep the real dev terminal by default, quote the skill dir, drop stale popover text ([5884a50](https://github.com/gutzerk/code_chroma/commit/5884a50c6894f6f6a07e5d6acd227f06ea10604d))
* only ask in the terminal when the CLI can hide the skill in a system prompt ([bb6c742](https://github.com/gutzerk/code_chroma/commit/bb6c7420c23367a9693b94f748601a0f4f546b48))
* own agent sessions in the production C# bridge ([26f54b6](https://github.com/gutzerk/code_chroma/commit/26f54b61bd4c71931da3adb502e59a8088609466))
* pin agent sessions to owned IDs ([2197bcc](https://github.com/gutzerk/code_chroma/commit/2197bcc537ace7982b44f4410181303f59f9d91d))
* preserve agent session metadata through runtime resolution ([00b922c](https://github.com/gutzerk/code_chroma/commit/00b922c1502a2b35009ddf4c0a15cf5dc716ae08))
* review fixes for diagram readability (focus clearing, derived sequence geometry, checker tiers, docs) ([266f51d](https://github.com/gutzerk/code_chroma/commit/266f51df5b68d9e4796b8e4cdbb0cc146a76acb4))
* **shell:** preserve clone tab and SSH configuration ([857befc](https://github.com/gutzerk/code_chroma/commit/857befcc09995222d65a8a21ab625ef229e68a66))
* track session changes across PowerShell and Python launches ([0af2ff5](https://github.com/gutzerk/code_chroma/commit/0af2ff57f4f37c081125d9049592ee8a5d861117))
* **web:** preserve exact colors/radii in token migration and tighten stylelint font rule ([59a5d11](https://github.com/gutzerk/code_chroma/commit/59a5d11314c8fcd0083b51060a5b6784ee769524))
* wrap long line in recipes test (ruff E501) ([8a0e4d0](https://github.com/gutzerk/code_chroma/commit/8a0e4d0a3bb2c3c534b3dc7bb67a969ad807ecaa))

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
