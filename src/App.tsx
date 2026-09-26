import { useCallback, useEffect, useRef, useState } from "react";
import { AUTO_ADVANCE_AFTER_ANSWER, AUTO_ADVANCE_DELAY_MS } from "./config";
import { sampleExam } from "./exam";
import {
  defaultSessionRepository,
  type SessionRepositoryContract,
} from "./session-repository";
import {
  formatDuration,
  getRemainingMs,
  pauseTimer,
  resumeTimer,
  startTimer,
  synchronizeTimer,
  systemClock,
  TIMER_UI_TICK_MS,
} from "./timer";
import type { ChoiceKey, Clock, ExamPack, ExamSession } from "./types";

const CHOICE_KEYS: ChoiceKey[] = ["A", "B", "C", "D", "E"];

function currentQuestionIndex(exam: ExamPack, session: ExamSession) {
  const index = exam.questions.findIndex((question) => question.id === session.currentQuestionId);
  return index >= 0 ? index : 0;
}

function routeTo(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function HomeScreen({ exam, session, onStart, interrupted, storageError }: {
  exam: ExamPack;
  session: ExamSession | null;
  onStart: () => void;
  interrupted: boolean;
  storageError: string | null;
}) {
  const resumable = session && ["RUNNING", "PAUSED"].includes(session.state);
  const questionIndex = session ? currentQuestionIndex(exam, session) : 0;
  return (
    <main className="home" aria-labelledby="exam-list-title">
      <section className="hero">
        <p className="eyebrow">Kişisel sınav alanı</p>
        <h1>YDS Çalışma</h1>
        <p className="hero-copy">Dikkat dağıtmayan, sakin bir çözüm deneyimi.</p>
      </section>

      <section aria-labelledby="exam-list-title">
        <div className="section-heading">
          <h2 id="exam-list-title">Sınavlar</h2>
          <span>1 sınav</span>
        </div>
        {interrupted && (
          <p className="notice" role="status">
            Bu sınav için devam edilecek aktif oturum bulunamadı. Yeni bir oturum başlatabilirsiniz.
          </p>
        )}
        {storageError && <p className="storage-warning" role="alert">{storageError}</p>}
        <article className="exam-card">
          <div className="exam-card-topline">
            <span className="practice-badge">AI Deneme</span>
            <span>{exam.language}</span>
          </div>
          <h3>{exam.title}</h3>
          <dl className="exam-meta">
            <div>
              <dt>Soru</dt>
              <dd>{exam.questionCount}</dd>
            </div>
            <div>
              <dt>Süre</dt>
              <dd>{exam.durationMinutes} dakika</dd>
            </div>
          </dl>
          {resumable && (
            <div className="active-session-summary" aria-label="Aktif sınav oturumu">
              <strong>{session.state === "PAUSED" ? "Duraklatıldı" : "Sınav devam ediyor"}</strong>
              <span>Soru {questionIndex + 1} / {exam.questionCount}</span>
            </div>
          )}
          <button className="primary-button" type="button" onClick={onStart}>
            {resumable ? "Devam Et" : session?.state === "EXPIRED" ? "Süreyi Gör" : "Sınava Başla"}
          </button>
        </article>
      </section>
    </main>
  );
}

function QuestionNavigator({
  exam,
  session,
  onClose,
  onSelect,
}: {
  exam: ExamPack;
  session: ExamSession;
  onClose: () => void;
  onSelect: (index: number) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const activeQuestionIndex = currentQuestionIndex(exam, session);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const closeButton = dialog?.querySelector<HTMLElement>("button");
    closeButton?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;

      const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled])")];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <div className="navigator-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="navigator-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="navigator-title"
        ref={dialogRef}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="navigator-header">
          <div>
            <p className="eyebrow">Sınav görünümü</p>
            <h2 id="navigator-title">Sorular</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Soruları kapat">
            Kapat
          </button>
        </div>

        <div className="navigator-legend" aria-label="Soru durumları">
          <span><i className="legend-dot answered" />Cevaplı</span>
          <span><i className="legend-dot flagged" />Sonra bak</span>
        </div>

        <div className="question-grid">
          {exam.questions.map((question, index) => {
            const isCurrent = index === activeQuestionIndex;
            const isAnswered = Boolean(session.answers[question.id]);
            const isFlagged = session.flaggedQuestionIds.includes(question.id);
            const labels = [
              `Soru ${question.number}`,
              isCurrent ? "mevcut" : "",
              isAnswered ? "cevaplandı" : "cevaplanmadı",
              isFlagged ? "sonra bak işaretli" : "",
            ].filter(Boolean);

            return (
              <button
                key={question.id}
                className="question-number"
                type="button"
                aria-label={labels.join(", ")}
                aria-current={isCurrent ? "step" : undefined}
                data-current={isCurrent || undefined}
                data-answered={isAnswered || undefined}
                data-flagged={isFlagged || undefined}
                onClick={() => onSelect(index)}
              >
                {question.number}
                {isFlagged && <span className="flag-mark" aria-hidden="true">●</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ExamPlayer({
  exam,
  session,
  remainingMs,
  onAnswer,
  onNavigate,
  onToggleFlag,
  onPause,
}: {
  exam: ExamPack;
  session: ExamSession;
  remainingMs: number;
  onAnswer: (answer: ChoiceKey) => void;
  onNavigate: (index: number) => void;
  onToggleFlag: () => void;
  onPause: () => void;
}) {
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const activeQuestionIndex = currentQuestionIndex(exam, session);
  const question = exam.questions[activeQuestionIndex];
  const selectedAnswer = session.answers[question.id];
  const flagged = session.flaggedQuestionIds.includes(question.id);
  const contentBlocks = question.contentBlockIds.map((id) =>
    exam.contentBlocks.find((block) => block.id === id),
  ).filter((block) => block !== undefined);
  const progress = ((activeQuestionIndex + 1) / exam.questionCount) * 100;

  const selectFromNavigator = (index: number) => {
    onNavigate(index);
    setNavigatorOpen(false);
  };

  return (
    <main className="player" aria-labelledby="question-title">
      <header className="player-header">
        <button className="brand-button" type="button" onClick={() => routeTo("/")}>
          YDS Çalışma
        </button>
        <div className="exam-timer" aria-label="Kalan süre">
          <span aria-live="off">{formatDuration(remainingMs)}</span>
          <button type="button" onClick={onPause}>Duraklat</button>
        </div>
      </header>

      <section className="player-summary" aria-label="Sınav ilerlemesi">
        <p className="exam-title">{exam.title}</p>
        <div className="progress-row">
          <strong>Soru {activeQuestionIndex + 1} / {exam.questionCount}</strong>
          <button className="text-button" type="button" onClick={() => setNavigatorOpen(true)}>
            Sorular
          </button>
        </div>
        <div className="progress-track" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
      </section>

      <article className="question-card" data-question-id={question.id}>
        <div className="question-actions">
          <span className="question-type">{question.type.replaceAll("_", " ")}</span>
          <button
            className="flag-button"
            type="button"
            aria-pressed={flagged}
            onClick={onToggleFlag}
          >
            <span aria-hidden="true">{flagged ? "◆" : "◇"}</span>
            {flagged ? "İşaretlendi" : "Sonra Bak"}
          </button>
        </div>

        {contentBlocks.map((block) => (
          <aside className="content-block" key={block.id} data-content-block-id={block.id}>
            <span>{block.type === "dialogue" ? "Diyalog" : "Passage"}</span>
            <p>{block.content}</p>
          </aside>
        ))}

        <h1 id="question-title" className="question-prompt">{question.prompt}</h1>

        <div className="answer-list" aria-label={`Soru ${question.number} seçenekleri`}>
          {CHOICE_KEYS.map((choiceKey) => {
            const selected = selectedAnswer === choiceKey;
            return (
              <button
                key={choiceKey}
                className="answer-choice"
                type="button"
                aria-pressed={selected}
                data-testid="answer-choice"
                data-selected={selected || undefined}
                onClick={() => onAnswer(choiceKey)}
              >
                <span className="choice-key">{choiceKey}</span>
                <span>{question.choices[choiceKey]}</span>
              </button>
            );
          })}
        </div>
      </article>

      <nav className="question-navigation" aria-label="Soru geçişleri">
        <button
          className="secondary-button"
          type="button"
          disabled={activeQuestionIndex === 0}
          onClick={() => onNavigate(activeQuestionIndex - 1)}
        >
          ← Önceki
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={activeQuestionIndex === exam.questions.length - 1}
          onClick={() => onNavigate(activeQuestionIndex + 1)}
        >
          Sonraki →
        </button>
      </nav>

      {navigatorOpen && (
        <QuestionNavigator
          exam={exam}
          session={session}
          onClose={() => setNavigatorOpen(false)}
          onSelect={selectFromNavigator}
        />
      )}
    </main>
  );
}

function PauseScreen({
  exam,
  session,
  remainingMs,
  onResume,
}: {
  exam: ExamPack;
  session: ExamSession;
  remainingMs: number;
  onResume: () => void;
}) {
  return (
    <main className="status-screen pause-screen" aria-labelledby="pause-title">
      <p className="eyebrow">{exam.title}</p>
      <h1 id="pause-title">Sınav Duraklatıldı</h1>
      <p className="status-question">Soru {currentQuestionIndex(exam, session) + 1} / {exam.questionCount}</p>
      <div className="status-timer" aria-label="Duraklatılmış kalan süre">
        <span>Kalan süre</span>
        <strong>{formatDuration(remainingMs)}</strong>
      </div>
      <button className="primary-button" type="button" onClick={onResume}>
        ▶ Devam Et
      </button>
      <p className="privacy-note">Soru içeriği duraklatma sırasında gizlenir.</p>
    </main>
  );
}

function ExpiredScreen({ exam }: { exam: ExamPack }) {
  return (
    <main className="status-screen expired-screen" aria-labelledby="expired-title">
      <p className="eyebrow">{exam.title}</p>
      <h1 id="expired-title">Süre Doldu</h1>
      <div className="status-timer" aria-label="Kalan süre">
        <span>Kalan süre</span>
        <strong>00:00:00</strong>
      </div>
      <p>Sınav süren tamamlandı.</p>
      <p className="notice">Sonuçlar sonraki fazda eklenecek.</p>
    </main>
  );
}

function withTimerSnapshot(
  session: ExamSession,
  snapshot: ReturnType<typeof synchronizeTimer>,
  nowMs: number,
): ExamSession {
  return {
    ...session,
    state: snapshot.status,
    timer: snapshot.timer,
    expiredAt: snapshot.status === "EXPIRED" ? (session.expiredAt ?? nowMs) : session.expiredAt,
  };
}

type HydrationState = "loading" | "ready" | "error";

function LoadingScreen() {
  return (
    <main className="loading-screen" aria-live="polite">
      <p className="eyebrow">YDS Çalışma</p>
      <h1>YDS Çalışma yükleniyor…</h1>
    </main>
  );
}

export function App({
  clock = systemClock,
  repository = defaultSessionRepository,
}: {
  clock?: Clock;
  repository?: SessionRepositoryContract;
}) {
  const [path, setPath] = useState(window.location.pathname);
  const [session, setSession] = useState<ExamSession | null>(null);
  const [nowMs, setNowMs] = useState(() => clock.now());
  const [hydrationState, setHydrationState] = useState<HydrationState>("loading");
  const [storageError, setStorageError] = useState<string | null>(null);
  const sessionRef = useRef<ExamSession | null>(null);
  const autoAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoAdvanceToken = useRef(0);

  const clearAutoAdvance = useCallback(() => {
    autoAdvanceToken.current += 1;
    if (autoAdvanceTimer.current !== null) {
      clearTimeout(autoAdvanceTimer.current);
      autoAdvanceTimer.current = null;
    }
  }, []);

  const persistSession = useCallback(async (nextSession: ExamSession, updatedAt: number) => {
    try {
      await repository.saveSession(nextSession, updatedAt);
    } catch (error) {
      console.error("[session-storage] save failed", error);
      setStorageError("İlerlemen kaydedilemedi. Lütfen uygulamayı kapatmadan önce tekrar dene.");
    }
  }, [repository]);

  const commitSession = useCallback((nextSession: ExamSession, updatedAt = clock.now()) => {
    sessionRef.current = nextSession;
    setSession(nextSession);
    return persistSession(nextSession, updatedAt);
  }, [clock, persistSession]);

  useEffect(() => {
    const handleRouteChange = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handleRouteChange);
    return () => window.removeEventListener("popstate", handleRouteChange);
  }, []);

  useEffect(() => clearAutoAdvance, [clearAutoAdvance]);

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      try {
        const restored = await repository.findLatestSessionForExam(sampleExam.id);
        if (cancelled) return;
        if (restored && !sampleExam.questions.some(({ id }) => id === restored.currentQuestionId)) {
          console.error(`[session-storage] ignored session ${restored.id} with unknown currentQuestionId`);
          setHydrationState("ready");
          return;
        }

        if (restored) {
          const currentNow = clock.now();
          const snapshot = synchronizeTimer(restored.timer, restored.state, currentNow);
          const reconciled = withTimerSnapshot(restored, snapshot, currentNow);
          sessionRef.current = reconciled;
          setSession(reconciled);
          setNowMs(currentNow);
          if (reconciled.state !== restored.state) {
            await persistSession(reconciled, currentNow);
          }
        }
        if (!cancelled) setHydrationState("ready");
      } catch (error) {
        console.error("[session-storage] hydration failed", error);
        if (!cancelled) {
          setStorageError("Kayıtlı ilerleme okunamadı. Yeni oturum bellekte kullanılabilir.");
          setHydrationState("error");
        }
      }
    };
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [clock, persistSession, repository]);

  useEffect(() => {
    if (session?.state !== "RUNNING") return;

    const refresh = () => {
      const currentNow = clock.now();
      setNowMs(currentNow);
      const current = sessionRef.current;
      if (!current || current.state !== "RUNNING") return;
      const snapshot = synchronizeTimer(current.timer, current.state, currentNow);
      if (snapshot.status === "EXPIRED") {
        clearAutoAdvance();
        void commitSession(withTimerSnapshot(current, snapshot, currentNow), currentNow);
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const intervalId = window.setInterval(refresh, TIMER_UI_TICK_MS);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", refresh);
    };
  }, [clearAutoAdvance, clock, commitSession, session?.state]);

  const expireIfNeeded = () => {
    const current = sessionRef.current;
    if (!current || current.state !== "RUNNING") return false;
    const currentNow = clock.now();
    const snapshot = synchronizeTimer(current.timer, current.state, currentNow);
    if (snapshot.status !== "EXPIRED") return false;
    clearAutoAdvance();
    setNowMs(currentNow);
    void commitSession(withTimerSnapshot(current, snapshot, currentNow), currentNow);
    return true;
  };

  const startOrContinueExam = () => {
    clearAutoAdvance();
    const existing = sessionRef.current;
    if (existing && ["RUNNING", "PAUSED", "EXPIRED"].includes(existing.state)) {
      routeTo(`/exam/${sampleExam.id}`);
      return;
    }

    const currentNow = clock.now();
    const timerSnapshot = startTimer(sampleExam.durationMinutes * 60_000, currentNow);
    const nextSession: ExamSession = {
      schemaVersion: 1,
      id: typeof crypto.randomUUID === "function"
        ? `session-${crypto.randomUUID()}`
        : `session-${currentNow}-${Math.random().toString(36).slice(2)}`,
      examId: sampleExam.id,
      examPackSchemaVersion: 1,
      currentQuestionId: sampleExam.questions[0].id,
      answers: {},
      flaggedQuestionIds: [],
      state: timerSnapshot.status,
      startedAt: currentNow,
      completedAt: null,
      expiredAt: null,
      timer: timerSnapshot.timer,
      result: null,
    };
    setNowMs(currentNow);
    void commitSession(nextSession, currentNow);
    routeTo(`/exam/${sampleExam.id}`);
  };

  const navigateToQuestion = (index: number) => {
    clearAutoAdvance();
    const current = sessionRef.current;
    if (!current || current.state !== "RUNNING" || expireIfNeeded()) return;
    const question = sampleExam.questions[index];
    if (!question) return;
    void commitSession({ ...current, currentQuestionId: question.id });
  };

  const answerCurrentQuestion = (answer: ChoiceKey) => {
    const current = sessionRef.current;
    if (!current || current.state !== "RUNNING" || expireIfNeeded()) return;
    clearAutoAdvance();
    const questionIndex = currentQuestionIndex(sampleExam, current);
    const question = sampleExam.questions[questionIndex];
    const answeredSession: ExamSession = {
      ...current,
      answers: { ...current.answers, [question.id]: answer },
    };
    const saveAnswer = commitSession(answeredSession);

    if (AUTO_ADVANCE_AFTER_ANSWER && questionIndex < sampleExam.questions.length - 1) {
      const expectedQuestionId = question.id;
      const token = autoAdvanceToken.current;
      void saveAnswer.then(() => {
        if (token !== autoAdvanceToken.current) return;
        autoAdvanceTimer.current = setTimeout(() => {
          const latest = sessionRef.current;
          const currentNow = clock.now();
          setNowMs(currentNow);
          if (!latest || latest.state !== "RUNNING" || latest.currentQuestionId !== expectedQuestionId) {
            return;
          }
          const snapshot = synchronizeTimer(latest.timer, latest.state, currentNow);
          if (snapshot.status === "EXPIRED") {
            void commitSession(withTimerSnapshot(latest, snapshot, currentNow), currentNow);
            return;
          }
          const nextQuestion = sampleExam.questions[questionIndex + 1];
          void commitSession({ ...latest, currentQuestionId: nextQuestion.id }, currentNow);
          autoAdvanceTimer.current = null;
        }, AUTO_ADVANCE_DELAY_MS);
      });
    }
  };

  const toggleCurrentFlag = () => {
    const current = sessionRef.current;
    if (!current || current.state !== "RUNNING" || expireIfNeeded()) return;
    const questionId = current.currentQuestionId;
    const isFlagged = current.flaggedQuestionIds.includes(questionId);
    void commitSession({
      ...current,
      flaggedQuestionIds: isFlagged
        ? current.flaggedQuestionIds.filter((id) => id !== questionId)
        : [...current.flaggedQuestionIds, questionId],
    });
  };

  const pauseExam = () => {
    const current = sessionRef.current;
    if (!current || current.state !== "RUNNING") return;
    clearAutoAdvance();
    const currentNow = clock.now();
    const snapshot = pauseTimer(current.timer, current.state, currentNow);
    setNowMs(currentNow);
    void commitSession(withTimerSnapshot(current, snapshot, currentNow), currentNow);
  };

  const resumeExam = () => {
    const current = sessionRef.current;
    if (!current || current.state !== "PAUSED") return;
    const currentNow = clock.now();
    const snapshot = resumeTimer(current.timer, current.state, currentNow);
    setNowMs(currentNow);
    void commitSession(withTimerSnapshot(current, snapshot, currentNow), currentNow);
  };

  if (hydrationState === "loading") return <LoadingScreen />;

  const examRoute = path === `/exam/${sampleExam.id}`;
  if (!examRoute || !session) {
    return (
      <HomeScreen
        exam={sampleExam}
        session={session}
        onStart={startOrContinueExam}
        interrupted={examRoute && !session}
        storageError={storageError}
      />
    );
  }

  const remainingMs = getRemainingMs(session.timer, session.state, nowMs);
  const storageWarning = storageError
    ? <p className="storage-warning global-storage-warning" role="alert">{storageError}</p>
    : null;
  if (session.state === "PAUSED") {
    return (
      <>
        {storageWarning}
        <PauseScreen exam={sampleExam} session={session} remainingMs={remainingMs} onResume={resumeExam} />
      </>
    );
  }
  if (session.state === "EXPIRED") {
    return <>{storageWarning}<ExpiredScreen exam={sampleExam} /></>;
  }

  return (
    <>
      {storageWarning}
      <ExamPlayer
        exam={sampleExam}
        session={session}
        remainingMs={remainingMs}
        onAnswer={answerCurrentQuestion}
        onNavigate={navigateToQuestion}
        onToggleFlag={toggleCurrentFlag}
        onPause={pauseExam}
      />
    </>
  );
}
