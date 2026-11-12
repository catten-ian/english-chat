import type { NpcId, PublicStage, StageId, WorldPoint } from '../content/world';
import type { FeedbackRecord } from './feedback';

export type QuizAnswer = { correct: boolean; explanation: string; selected: number };
export type ChapterQuiz = { quizId: string; stageId: StageId; questions: { q: string; options: string[] }[]; answers: (QuizAnswer | null)[] };
export type StageFeedback = { id?: string; stageId: string; status: 'pending' | 'retry' | 'ready' | 'failed' | 'unavailable'; text?: string; error?: string; pendingCount?: number };
export type ChapterSettlement = { stageId: StageId; complete: boolean; summary: string; score: number; total: number; nextStageId?: StageId; feedbackSummary?: StageFeedback; completedAt?: number | string };
export type Journey = {
  stageId: StageId;
  unlockedStageIds: StageId[];
  completedStageIds: StageId[];
  stages: PublicStage[];
  position: WorldPoint;
  npcPositions: Partial<Record<NpcId, WorldPoint>>;
  evidence: { id: string; text: string; source: string; stageId: string }[];
  visitedNpcIds: NpcId[];
  lastNpcId?: NpcId;
  quiz?: ChapterQuiz;
  feedback: { records: FeedbackRecord[]; summaries: StageFeedback[] };
  settlements?: ChapterSettlement[];
  chapterLog?: ChapterSettlement[];
};
export type JourneyApi = ReturnType<typeof createJourneyApi>;

export class GameApiError extends Error {
  constructor(public readonly status: number, public readonly detail: Record<string, unknown>) {
    super(typeof detail.error === 'string' ? detail.error : 'The harbor connection was interrupted.');
  }
}

export function createJourneyApi(options: { apiBase: string; headers(): HeadersInit; provider(): { provider: string; model?: string } }) {
  const controllers = new Set<AbortController>();
  let disposed = false;
  async function request<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    if (disposed) throw new Error('Game session closed.');
    const controller = new AbortController(); controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch(`${options.apiBase}/api/world-game/${path}`, {
        method: body ? 'POST' : 'GET', headers: options.headers(), signal: controller.signal,
        ...(body ? { body: JSON.stringify({ ...body, ...options.provider() }) } : {})
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new GameApiError(response.status, data);
      return data as T;
    } finally { clearTimeout(timeout); controllers.delete(controller); }
  }
  return {
    load: () => request<Journey>('state'),
    switchStage: (stageId: StageId) => request<Journey>('state', { stageId }),
    questions: (stageId: StageId) => request<ChapterQuiz>('questions', { stageId }),
    answer: (quizId: string, index: number, choice: number) => request<QuizAnswer>('answer', { quizId, index, choice }),
    settle: (quizId: string) => request<ChapterSettlement>('settle', { quizId }),
    feedback: () => request<Journey['feedback']>('feedback'),
    retryFeedback: (id: string) => request('feedback/retry', { id }),
    dispose() { disposed = true; for (const controller of controllers) controller.abort(); controllers.clear(); }
  };
}

export function nextQuestion(quiz: ChapterQuiz) {
  return quiz.questions.findIndex((_, index) => !quiz.answers[index]);
}
export function chapterError(error: unknown) {
  if (error instanceof GameApiError) {
    if (error.status === 401) return 'Sign in from the English app, then return to continue your journey.';
    if (Array.isArray(error.detail.missingNpcIds)) return 'There are still residents to interview. Return to the harbor and compare their accounts.';
    if (error.status === 403) return 'This chapter is not yet unlocked. Finish the current investigation first.';
    if (error.status === 429) return 'The harbor line is busy. Wait a moment, then try again.';
    if (error.status === 409) return 'Your investigation changed. Refresh the chapter log and continue from your saved progress.';
  }
  return 'The connection was interrupted. Your saved progress is safe; try again when the line returns.';
}
