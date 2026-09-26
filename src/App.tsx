import { useCallback, useEffect, useRef, useState } from "react";
import { AUTO_ADVANCE_AFTER_ANSWER, AUTO_ADVANCE_DELAY_MS } from "./config";
import { sampleExam } from "./exam";
import type { ChoiceKey, ExamPack, ExamSession } from "./types";

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
            const isFlagged = session.flaggedQuestions.includes(question.id);
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
  onAnswer,
  onNavigate,
  onToggleFlag,
}: {
  exam: ExamPack;
  session: ExamSession;
  onAnswer: (answer: ChoiceKey) => void;
  onNavigate: (index: number) => void;
  onToggleFlag: () => void;
}) {
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const question = exam.questions[session.currentQuestionIndex];
  const selectedAnswer = session.answers[question.id];
  const flagged = session.flaggedQuestions.includes(question.id);
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
        <div className="timer-placeholder" aria-label="Süre, Phase 4 için statik gösterim">
          <span>03:00:00</span>
          <button type="button" disabled title="Duraklatma Phase 4'te eklenecek">Duraklat</button>
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

export function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [session, setSession] = useState<ExamSession | null>(null);
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

  const startExam = () => {
    clearAutoAdvance();
    setSession({
      examId: sampleExam.id,
      currentQuestionIndex: 0,
      answers: {},
      flaggedQuestions: [],
      state: "RUNNING",
      timer: {
        durationSeconds: sampleExam.durationMinutes * 60,
        phase: "PHASE_4_PLACEHOLDER",
      },
    });
    routeTo(`/exam/${sampleExam.id}`);
  };

  const navigateToQuestion = (index: number) => {
    clearAutoAdvance();
    if (index < 0 || index >= sampleExam.questions.length) return;
    setSession((current) => current ? { ...current, currentQuestionIndex: index } : current);
  };

  const answerCurrentQuestion = (answer: ChoiceKey) => {
    if (!session) return;
    clearAutoAdvance();
    const question = sampleExam.questions[session.currentQuestionIndex];
    setSession((current) => current ? {
      ...current,
      answers: { ...current.answers, [question.id]: answer },
    } : current);

    const hasNextQuestion = session.currentQuestionIndex < sampleExam.questions.length - 1;
    if (AUTO_ADVANCE_AFTER_ANSWER && hasNextQuestion) {
      const expectedIndex = session.currentQuestionIndex;
      autoAdvanceTimer.current = setTimeout(() => {
        setSession((current) => {
          if (!current || current.currentQuestionIndex !== expectedIndex) return current;
          return { ...current, currentQuestionIndex: expectedIndex + 1 };
        });
        autoAdvanceTimer.current = null;
      }, AUTO_ADVANCE_DELAY_MS);
    }
  };

  const toggleCurrentFlag = () => {
    if (!session) return;
    const questionId = sampleExam.questions[session.currentQuestionIndex].id;
    setSession((current) => {
      if (!current) return current;
      const isFlagged = current.flaggedQuestions.includes(questionId);
      return {
        ...current,
        flaggedQuestions: isFlagged
          ? current.flaggedQuestions.filter((id) => id !== questionId)
          : [...current.flaggedQuestions, questionId],
      };
    });
  };

  const examRoute = path === `/exam/${sampleExam.id}`;
  if (!examRoute || !session) {
    return <HomeScreen exam={sampleExam} onStart={startExam} interrupted={examRoute && !session} />;
  }

  return (
    <ExamPlayer
      exam={sampleExam}
      session={session}
      onAnswer={answerCurrentQuestion}
      onNavigate={navigateToQuestion}
      onToggleFlag={toggleCurrentFlag}
    />
  );
}
