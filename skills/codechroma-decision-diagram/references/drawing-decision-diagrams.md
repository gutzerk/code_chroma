# What a decision diagram shows

- Boxes are the parts the option involves: services, stores, queues, owners. Not files or classes.
- Arrows are one kind of relation per diagram (calls, data, ownership); label them with a verb.
- Mark what the option adds with `status: "new"`; leave existing parts plain.
- Keep the same box ids and labels across the options so the user can compare them.
- Prefer 5-8 nodes. Over 12 is rejected; if you need more, the question is two questions.
- One root per option: the tool makes it and returns its id as `diagram_ref`.
- Every node gets a `description`: one sentence on what changes for that part under this option (or
  what it does, if unchanged). More than half the nodes without one earns a warning from the tool.
- Every edge gets a verb `label` ("publishes", "reads", "owns"), never a noun or empty.
- Show what this option adds or changes versus today: existing parts plain, the option's additions
  `status: "new"`, so the user sees the delta rather than the whole system.
- All options of one question land on one canvas layer (`decisions/<question_id>`), one root each.
