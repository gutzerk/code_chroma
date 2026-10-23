# What a decision diagram shows

- Boxes are the parts the option involves: services, stores, queues, owners. Not files or classes.
- Arrows are one kind of relation per diagram (calls, data, ownership); label them with a verb.
- Mark what the option adds with `status: "new"`; leave existing parts plain.
- Keep the same box ids and labels across the options so the user can compare them.
- Prefer 5-8 nodes. Over 12 is rejected; if you need more, the question is two questions.
- One root per option: the tool makes it and returns its id as `diagram_ref`.
