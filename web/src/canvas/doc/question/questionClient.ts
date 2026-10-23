import type { EngineClient } from "../../../engine-client/EngineClient";
import type { QuestionAck, QuestionView } from "./questionAdapter";

/** Thin helpers over the EngineClient question routes so components don't hand-build bodies. */

export function answerOption(
  client: EngineClient,
  q: QuestionView,
  optionId: string,
): Promise<QuestionAck> {
  const option = q.options.find((o) => o.id === optionId);
  return client.answerQuestion(q.questionId, { answer: option?.title ?? optionId, option_id: optionId });
}

export function answerCustom(
  client: EngineClient,
  q: QuestionView,
  text: string,
): Promise<QuestionAck> {
  return client.answerQuestion(q.questionId, { answer: text, option_id: null });
}

export function skipQuestion(client: EngineClient, q: QuestionView): Promise<QuestionAck> {
  return client.skipQuestion(q.questionId);
}

export function reviseQuestion(client: EngineClient, q: QuestionView): Promise<QuestionAck> {
  return client.reviseQuestion(q.questionId);
}

export function requestDiagram(client: EngineClient, q: QuestionView): Promise<QuestionAck> {
  return client.requestQuestionDiagram(q.questionId);
}

export function listOpenQuestions(client: EngineClient): Promise<QuestionAck[]> {
  return client.getOpenQuestions().then((payload) => payload.questions);
}
