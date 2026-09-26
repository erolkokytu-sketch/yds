import { useCallback, useEffect, useRef, useState } from "react";
import { AUTO_ADVANCE_AFTER_ANSWER, AUTO_ADVANCE_DELAY_MS } from "./config";
import { sampleExam } from "./exam";
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

function routeTo(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function HomeScreen({ exam, onStart, interrupted }: {
  exam: ExamPack;
  onStart: () => void;
  interrupted: boolean;
}) {
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
            Bu oturum yalnızca bellekte tutulur. Sınavı yeniden başlatabilirsiniz.
          </p>
        )}
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
          <button className="primary-button" type="button" onClick={onStart}>
            Sınava Başla
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
            const isCurrent = index === session.currentQuestionIndex;
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
  const question = exam.questions[session.currentQuestionIndex];
  const selectedAnswer = session.answers[question.id];
  const flagged = session.flaggedQuestionIds.includes(question.id);
  const contentBlocks = question.contentBlockIds.map((id) =>
    exam.contentBlocks.find((block) => block.id === id),
  ).filter((block) => block !== undefined);
  const progress = ((session.currentQuestionIndex + 1) / exam.questionCount) * 100;

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
          <strong>Soru {session.currentQuestionIndex + 1} / {exam.questionCount}</strong>
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
          disabled={session.currentQuestionIndex === 0}
          onClick={() => onNavigate(session.currentQuestionIndex - 1)}
        >
          ← Önceki
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={session.currentQuestionIndex === exam.questions.length - 1}
          onClick={() => onNavigate(session.currentQuestionIndex + 1)}
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
      <p className="status-question">Soru {session.currentQuestionIndex + 1} / {exam.questionCount}</p>
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

export function App({ clock = systemClock }: { clock?: Clock }) {
  const [path, setPath] = useState(window.location.pathname);
  const [session, setSession] = useState<ExamSession | null>(null);
  const [nowMs, setNowMs] = useState(() => clock.now());
  const autoAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAutoAdvance = useCallback(() => {
    if (autoAdvanceTimer.current !== null) {
      clearTimeout(autoAdvanceTimer.current);
      autoAdvanceTimer.current = null;
    }
  }, []);

  useEffect(() => {
    const handleRouteChange = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handleRouteChange);
    return () => window.removeEventListener("popstate", handleRouteChange);
  }, []);

  useEffect(() => clearAutoAdvance, [clearAutoAdvance]);

  useEffect(() => {
    if (session?.state !== "RUNNING") return;

    const refresh = () => {
      const currentNow = clock.now();
      setNowMs(currentNow);
      setSession((current) => {
        if (!current || current.state !== "RUNNING") return current;
        const snapshot = synchronizeTimer(current.timer, current.state, currentNow);
        if (snapshot.status === "EXPIRED") clearAutoAdvance();
        return withTimerSnapshot(current, snapshot, currentNow);
      });
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
  }, [clearAutoAdvance, clock, session?.state]);

  const expireIfNeeded = () => {
    if (!session || session.state !== "RUNNING") return false;
    const currentNow = clock.now();
    const snapshot = synchronizeTimer(session.timer, session.state, currentNow);
    if (snapshot.status !== "EXPIRED") return false;
    clearAutoAdvance();
    setNowMs(currentNow);
    setSession(withTimerSnapshot(session, snapshot, currentNow));
    return true;
  };

  const startExam = () => {
    clearAutoAdvance();
    const currentNow = clock.now();
    const timerSnapshot = startTimer(sampleExam.durationMinutes * 60_000, currentNow);
    setNowMs(currentNow);
    setSession({
      schemaVersion: 1,
      id: `session-${currentNow}`,
      examId: sampleExam.id,
      examPackSchemaVersion: 1,
      currentQuestionIndex: 0,
      answers: {},
      flaggedQuestionIds: [],
      state: timerSnapshot.status,
      startedAt: currentNow,
      completedAt: null,
      expiredAt: null,
      timer: timerSnapshot.timer,
      result: null,
    });
    routeTo(`/exam/${sampleExam.id}`);
  };

  const navigateToQuestion = (index: number) => {
    clearAutoAdvance();
    if (!session || session.state !== "RUNNING" || expireIfNeeded()) return;
    if (index < 0 || index >= sampleExam.questions.length) return;
    setSession((current) => current?.state === "RUNNING"
      ? { ...current, currentQuestionIndex: index }
      : current);
  };

  const answerCurrentQuestion = (answer: ChoiceKey) => {
    if (!session || session.state !== "RUNNING" || expireIfNeeded()) return;
    clearAutoAdvance();
    const question = sampleExam.questions[session.currentQuestionIndex];
    setSession((current) => current?.state === "RUNNING" ? {
      ...current,
      answers: { ...current.answers, [question.id]: answer },
    } : current);

    const hasNextQuestion = session.currentQuestionIndex < sampleExam.questions.length - 1;
    if (AUTO_ADVANCE_AFTER_ANSWER && hasNextQuestion) {
      const expectedIndex = session.currentQuestionIndex;
      autoAdvanceTimer.current = setTimeout(() => {
        const currentNow = clock.now();
        setNowMs(currentNow);
        setSession((current) => {
          if (!current || current.state !== "RUNNING") return current;
          const snapshot = synchronizeTimer(current.timer, current.state, currentNow);
          if (snapshot.status === "EXPIRED") {
            return withTimerSnapshot(current, snapshot, currentNow);
          }
          if (current.currentQuestionIndex !== expectedIndex) return current;
          return { ...current, currentQuestionIndex: expectedIndex + 1 };
        });
        autoAdvanceTimer.current = null;
      }, AUTO_ADVANCE_DELAY_MS);
    }
  };

  const toggleCurrentFlag = () => {
    if (!session || session.state !== "RUNNING" || expireIfNeeded()) return;
    const questionId = sampleExam.questions[session.currentQuestionIndex].id;
    setSession((current) => {
      if (!current || current.state !== "RUNNING") return current;
      const isFlagged = current.flaggedQuestionIds.includes(questionId);
      return {
        ...current,
        flaggedQuestionIds: isFlagged
          ? current.flaggedQuestionIds.filter((id) => id !== questionId)
          : [...current.flaggedQuestionIds, questionId],
      };
    });
  };

  const pauseExam = () => {
    if (!session || session.state !== "RUNNING") return;
    clearAutoAdvance();
    const currentNow = clock.now();
    const snapshot = pauseTimer(session.timer, session.state, currentNow);
    setNowMs(currentNow);
    setSession(withTimerSnapshot(session, snapshot, currentNow));
  };

  const resumeExam = () => {
    if (!session || session.state !== "PAUSED") return;
    const currentNow = clock.now();
    const snapshot = resumeTimer(session.timer, session.state, currentNow);
    setNowMs(currentNow);
    setSession(withTimerSnapshot(session, snapshot, currentNow));
  };

  const examRoute = path === `/exam/${sampleExam.id}`;
  if (!examRoute || !session) {
    return <HomeScreen exam={sampleExam} onStart={startExam} interrupted={examRoute && !session} />;
  }

  const remainingMs = getRemainingMs(session.timer, session.state, nowMs);
  if (session.state === "PAUSED") {
    return (
      <PauseScreen
        exam={sampleExam}
        session={session}
        remainingMs={remainingMs}
        onResume={resumeExam}
      />
    );
  }
  if (session.state === "EXPIRED") return <ExpiredScreen exam={sampleExam} />;

  return (
    <ExamPlayer
      exam={sampleExam}
      session={session}
      remainingMs={remainingMs}
      onAnswer={answerCurrentQuestion}
      onNavigate={navigateToQuestion}
      onToggleFlag={toggleCurrentFlag}
      onPause={pauseExam}
    />
  );
}
