import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AUTO_ADVANCE_AFTER_ANSWER, AUTO_ADVANCE_DELAY_MS } from "./config";
import { sampleExam } from "./exam";
import { finalizeExamSession, getQuestionOutcome, type QuestionOutcome } from "./result";
import { answerSession, navigateSession, toggleFlagSession } from "./session-actions";
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
import type { ChoiceKey, Clock, CompletionReason, ExamPack, ExamSession } from "./types";

const CHOICE_KEYS: ChoiceKey[] = ["A", "B", "C", "D", "E"];

function currentQuestionIndex(exam: ExamPack, session: ExamSession) {
  const index = exam.questions.findIndex((question) => question.id === session.currentQuestionId);
  return index >= 0 ? index : 0;
}

function routeTo(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function HomeScreen({
  exam,
  session,
  onStart,
  onViewResult,
  onRequestRetake,
  interrupted,
  storageError,
}: {
  exam: ExamPack;
  session: ExamSession | null;
  onStart: () => void;
  onViewResult: () => void;
  onRequestRetake: () => void;
  interrupted: boolean;
  storageError: string | null;
}) {
  const resumable = session && ["RUNNING", "PAUSED"].includes(session.state);
  const completedResult = session && ["COMPLETED", "EXPIRED"].includes(session.state)
    ? session.result
    : null;
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
          {completedResult && (
            <div className="active-session-summary" aria-label="Son sınav sonucu">
              <strong>Son sonuç</strong>
              <span>{completedResult.correct} doğru · {completedResult.incorrect} yanlış · {completedResult.blank} boş</span>
            </div>
          )}
          {completedResult ? (
            <div className="home-actions">
              <button className="primary-button" type="button" onClick={onViewResult}>Sonucu Gör</button>
              <button className="secondary-button" type="button" onClick={onRequestRetake}>Yeniden Çöz</button>
            </div>
          ) : (
            <button className="primary-button" type="button" onClick={onStart}>
              {resumable ? "Devam Et" : "Sınava Başla"}
            </button>
          )}
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
  onRequestFinish,
}: {
  exam: ExamPack;
  session: ExamSession;
  remainingMs: number;
  onAnswer: (answer: ChoiceKey) => void;
  onNavigate: (index: number) => void;
  onToggleFlag: () => void;
  onPause: () => void;
  onRequestFinish: () => void;
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
        <div className="player-header-actions">
          <button className="finish-link" type="button" onClick={onRequestFinish}>Sınavı Bitir</button>
          <div className="exam-timer" aria-label="Kalan süre">
            <span aria-live="off">{formatDuration(remainingMs)}</span>
            <button type="button" onClick={onPause}>Duraklat</button>
          </div>
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
  onRequestFinish,
}: {
  exam: ExamPack;
  session: ExamSession;
  remainingMs: number;
  onResume: () => void;
  onRequestFinish: () => void;
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
      <button className="finish-link" type="button" onClick={onRequestFinish}>Sınavı Bitir</button>
      <p className="privacy-note">Soru içeriği duraklatma sırasında gizlenir.</p>
    </main>
  );
}

function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busy = false,
  destructive = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("button")?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onCancel();
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
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [busy, onCancel]);

  return (
    <div className="navigator-backdrop" role="presentation" onMouseDown={() => !busy && onCancel()}>
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        ref={dialogRef}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-dialog-title">{title}</h2>
        {children}
        <div className="confirm-actions">
          <button className="secondary-button" type="button" onClick={onCancel} disabled={busy}>
            Vazgeç
          </button>
          <button
            className={destructive ? "danger-button" : "primary-button"}
            type="button"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Kaydediliyor…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function FinishDialog({ session, remainingMs, busy, onCancel, onConfirm }: {
  session: ExamSession;
  remainingMs: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const answered = Object.keys(session.answers).length;
  return (
    <ConfirmDialog
      title="Sınavı bitirmek istediğine emin misin?"
      confirmLabel="Sınavı Bitir"
      busy={busy}
      destructive
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <dl className="finish-summary">
        <div><dt>Cevaplanan</dt><dd>{answered}</dd></div>
        <div><dt>Boş</dt><dd>{sampleExam.questionCount - answered}</dd></div>
        <div><dt>Sonra Bak</dt><dd>{session.flaggedQuestionIds.length}</dd></div>
        <div><dt>Kalan süre</dt><dd>{formatDuration(remainingMs)}</dd></div>
      </dl>
    </ConfirmDialog>
  );
}

function ResultScreen({ exam, session, onReview, onHome }: {
  exam: ExamPack;
  session: ExamSession;
  onReview: () => void;
  onHome: () => void;
}) {
  const result = session.result!;
  const expired = result.completionReason === "expired";
  return (
    <main className="result-screen" aria-labelledby="result-title">
      <p className="eyebrow">{exam.title}</p>
      <h1 id="result-title">{expired ? "Süre Doldu" : "Sınav Tamamlandı"}</h1>
      {expired && <p className="expired-time" aria-label="Kalan süre">00:00:00</p>}
      <section className="result-grid" aria-label="Sınav sonucu">
        <div><span>Doğru</span><strong>{result.correct}</strong></div>
        <div><span>Yanlış</span><strong>{result.incorrect}</strong></div>
        <div><span>Boş</span><strong>{result.blank}</strong></div>
        <div><span>Cevaplanan</span><strong>{result.answered} / {result.totalQuestions}</strong></div>
      </section>
      {result.score !== null && (
        <p className="score-result"><span>Puan</span><strong>{result.score.toFixed(2)}</strong></p>
      )}
      <p className="completion-reason">
        Tamamlama: <strong>{expired ? "Süre doldu" : "Manuel"}</strong>
      </p>
      <div className="result-actions">
        <button className="primary-button" type="button" onClick={onReview}>Soruları İncele</button>
        <button className="secondary-button" type="button" onClick={onHome}>Ana Sayfaya Dön</button>
      </div>
    </main>
  );
}

type ReviewFilter = "all" | QuestionOutcome | "flagged";
const REVIEW_FILTERS: Array<{ value: ReviewFilter; label: string }> = [
  { value: "all", label: "Tümü" },
  { value: "incorrect", label: "Yanlışlar" },
  { value: "blank", label: "Boşlar" },
  { value: "correct", label: "Doğrular" },
  { value: "flagged", label: "Sonra Bak" },
];

function ReviewScreen({ exam, session, onResults }: {
  exam: ExamPack;
  session: ExamSession;
  onResults: () => void;
}) {
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [position, setPosition] = useState(0);
  const questions = exam.questions.filter((question) => filter === "all"
    || (filter === "flagged"
      ? session.flaggedQuestionIds.includes(question.id)
      : getQuestionOutcome(exam, session.answers, question.id) === filter));
  const question = questions[position];
  const filterLabel = REVIEW_FILTERS.find(({ value }) => value === filter)?.label ?? "Tümü";

  const changeFilter = (nextFilter: ReviewFilter) => {
    setFilter(nextFilter);
    setPosition(0);
  };

  return (
    <main className="review-screen" aria-labelledby="review-title">
      <header className="review-header">
        <div>
          <p className="eyebrow">{exam.title}</p>
          <h1 id="review-title">Soruları İncele</h1>
        </div>
        <button className="secondary-button" type="button" onClick={onResults}>Sonuçlara Dön</button>
      </header>
      <nav className="review-filters" aria-label="İnceleme filtreleri">
        {REVIEW_FILTERS.map(({ value, label }) => (
          <button
            type="button"
            key={value}
            aria-pressed={filter === value}
            onClick={() => changeFilter(value)}
          >
            {label}
          </button>
        ))}
      </nav>

      {!question ? (
        <section className="review-empty" role="status">
          <h2>Bu filtrede soru yok</h2>
          <p>Başka bir filtre seçebilirsin.</p>
        </section>
      ) : (
        <ReviewQuestion
          exam={exam}
          session={session}
          question={question}
          positionLabel={`${filterLabel} ${position + 1} / ${questions.length}`}
        />
      )}

      {question && (
        <nav className="question-navigation" aria-label="İnceleme geçişleri">
          <button
            className="secondary-button"
            type="button"
            disabled={position === 0}
            onClick={() => setPosition((current) => current - 1)}
          >
            ← Önceki
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={position === questions.length - 1}
            onClick={() => setPosition((current) => current + 1)}
          >
            Sonraki →
          </button>
        </nav>
      )}
    </main>
  );
}

function ReviewQuestion({ exam, session, question, positionLabel }: {
  exam: ExamPack;
  session: ExamSession;
  question: ExamPack["questions"][number];
  positionLabel: string;
}) {
  const userAnswer = session.answers[question.id];
  const correctAnswer = exam.answerKey.answers[question.id];
  const outcome = getQuestionOutcome(exam, session.answers, question.id);
  const contentBlocks = question.contentBlockIds.map((id) =>
    exam.contentBlocks.find((block) => block.id === id)).filter((block) => block !== undefined);
  return (
    <article className="question-card review-question" data-question-id={question.id} data-outcome={outcome}>
      <div className="review-question-heading">
        <strong>{positionLabel}</strong>
        <span>Soru {question.number}</span>
      </div>
      {contentBlocks.map((block) => (
        <aside className="content-block" key={block.id}>
          <span>{block.type === "dialogue" ? "Diyalog" : "Passage"}</span>
          <p>{block.content}</p>
        </aside>
      ))}
      <h2 className="question-prompt">{question.prompt}</h2>
      <p className={`review-outcome ${outcome}`}>
        {outcome === "correct" ? "Doğru cevapladın" : outcome === "incorrect" ? "Yanlış cevapladın" : "Boş bıraktın"}
      </p>
      <div className="review-answer-summary">
        <span>Senin cevabın: <strong>{userAnswer ?? "Boş"}</strong></span>
        <span>Doğru cevap: <strong>{correctAnswer}</strong></span>
      </div>
      <div className="answer-list" aria-label={`Soru ${question.number} seçenekleri`}>
        {CHOICE_KEYS.map((choiceKey) => {
          const isUser = userAnswer === choiceKey;
          const isCorrect = correctAnswer === choiceKey;
          const answerState = isCorrect ? "correct" : isUser ? "incorrect" : "neutral";
          return (
            <div
              className="answer-choice review-choice"
              data-testid="review-choice"
              data-answer-state={answerState}
              key={choiceKey}
            >
              <span className="choice-key">{choiceKey}</span>
              <span>{question.choices[choiceKey]}</span>
              <span className="choice-review-label">
                {isUser && isCorrect
                  ? "Senin cevabın · Doğru cevap"
                  : isUser
                    ? "Senin cevabın · Yanlış"
                    : isCorrect
                      ? "Doğru cevap"
                      : ""}
              </span>
            </div>
          );
        })}
      </div>
    </article>
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
  const [finishOpen, setFinishOpen] = useState(false);
  const [retakeOpen, setRetakeOpen] = useState(false);
  const [completionSaving, setCompletionSaving] = useState(false);
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

  const finalizeCurrentSession = useCallback(async (completionReason: CompletionReason) => {
    const current = sessionRef.current;
    if (!current) return;
    if (["COMPLETED", "EXPIRED"].includes(current.state) && current.result) {
      setSession(current);
      return;
    }

    clearAutoAdvance();
    const completedAt = clock.now();
    const terminal = finalizeExamSession(sampleExam, current, completionReason, completedAt);
    sessionRef.current = terminal;
    setCompletionSaving(true);
    try {
      await repository.saveSession(terminal, completedAt);
      setStorageError(null);
      setSession(terminal);
      setFinishOpen(false);
    } catch (error) {
      console.error("[session-storage] completion save failed", error);
      setStorageError("Sınav sonucu kaydedilemedi. Lütfen tekrar dene.");
      if (completionReason === "manual") {
        sessionRef.current = current;
      } else {
        setSession(terminal);
      }
    } finally {
      setCompletionSaving(false);
    }
  }, [clearAutoAdvance, clock, repository]);

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
        const active = await repository.findActiveSessionForExam(sampleExam.id);
        const restored = active
          ?? await repository.findLatestCompletedAttemptForExam(sampleExam.id);
        if (cancelled) return;
        if (restored && !sampleExam.questions.some(({ id }) => id === restored.currentQuestionId)) {
          console.error(`[session-storage] ignored session ${restored.id} with unknown currentQuestionId`);
          setHydrationState("ready");
          return;
        }

        if (restored) {
          const currentNow = clock.now();
          const snapshot = synchronizeTimer(restored.timer, restored.state, currentNow);
          const timerReconciled = withTimerSnapshot(restored, snapshot, currentNow);
          const needsExpirationResult = timerReconciled.state === "EXPIRED" && !timerReconciled.result;
          const reconciled = needsExpirationResult
            ? finalizeExamSession(sampleExam, timerReconciled, "expired", currentNow)
            : timerReconciled;
          if (reconciled !== restored
            && (reconciled.state !== restored.state || reconciled.result !== restored.result)) {
            await persistSession(reconciled, currentNow);
          }
          sessionRef.current = reconciled;
          setSession(reconciled);
          setNowMs(currentNow);
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
        sessionRef.current = withTimerSnapshot(current, snapshot, currentNow);
        void finalizeCurrentSession("expired");
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
  }, [clock, finalizeCurrentSession, session?.state]);

  const expireIfNeeded = () => {
    const current = sessionRef.current;
    if (!current || current.state !== "RUNNING") return false;
    const currentNow = clock.now();
    const snapshot = synchronizeTimer(current.timer, current.state, currentNow);
    if (snapshot.status !== "EXPIRED") return false;
    setNowMs(currentNow);
    sessionRef.current = withTimerSnapshot(current, snapshot, currentNow);
    void finalizeCurrentSession("expired");
    return true;
  };

  const createNewSession = () => {
    clearAutoAdvance();
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
      completionReason: null,
      expiredAt: null,
      timer: timerSnapshot.timer,
      result: null,
    };
    setNowMs(currentNow);
    void commitSession(nextSession, currentNow);
    routeTo(`/exam/${sampleExam.id}`);
  };

  const startOrContinueExam = () => {
    const existing = sessionRef.current;
    if (existing && ["RUNNING", "PAUSED"].includes(existing.state)) {
      routeTo(`/exam/${sampleExam.id}`);
      return;
    }
    createNewSession();
  };

  const startRetake = () => {
    setRetakeOpen(false);
    createNewSession();
  };

  const navigateToQuestion = (index: number) => {
    clearAutoAdvance();
    const current = sessionRef.current;
    if (!current || current.state !== "RUNNING" || expireIfNeeded()) return;
    const question = sampleExam.questions[index];
    if (!question) return;
    void commitSession(navigateSession(current, question.id));
  };

  const answerCurrentQuestion = (answer: ChoiceKey) => {
    const current = sessionRef.current;
    if (!current || current.state !== "RUNNING" || expireIfNeeded()) return;
    clearAutoAdvance();
    const questionIndex = currentQuestionIndex(sampleExam, current);
    const question = sampleExam.questions[questionIndex];
    const answeredSession = answerSession(current, question.id, answer);
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
            sessionRef.current = withTimerSnapshot(latest, snapshot, currentNow);
            void finalizeCurrentSession("expired");
            return;
          }
          const nextQuestion = sampleExam.questions[questionIndex + 1];
          void commitSession(navigateSession(latest, nextQuestion.id), currentNow);
          autoAdvanceTimer.current = null;
        }, AUTO_ADVANCE_DELAY_MS);
      });
    }
  };

  const toggleCurrentFlag = () => {
    const current = sessionRef.current;
    if (!current || current.state !== "RUNNING" || expireIfNeeded()) return;
    const questionId = current.currentQuestionId;
    void commitSession(toggleFlagSession(current, questionId));
  };

  const pauseExam = () => {
    const current = sessionRef.current;
    if (!current || current.state !== "RUNNING") return;
    clearAutoAdvance();
    const currentNow = clock.now();
    const snapshot = pauseTimer(current.timer, current.state, currentNow);
    setNowMs(currentNow);
    if (snapshot.status === "EXPIRED") {
      sessionRef.current = withTimerSnapshot(current, snapshot, currentNow);
      void finalizeCurrentSession("expired");
      return;
    }
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
  const reviewRoute = path === `/exam/${sampleExam.id}/review`;
  if ((!examRoute && !reviewRoute) || !session) {
    return (
      <>
        <HomeScreen
          exam={sampleExam}
          session={session}
          onStart={startOrContinueExam}
          onViewResult={() => routeTo(`/exam/${sampleExam.id}`)}
          onRequestRetake={() => setRetakeOpen(true)}
          interrupted={(examRoute || reviewRoute) && !session}
          storageError={storageError}
        />
        {retakeOpen && (
          <ConfirmDialog
            title="Yeni bir sınav başlatılsın mı?"
            confirmLabel="Yeni Sınav"
            onCancel={() => setRetakeOpen(false)}
            onConfirm={startRetake}
          >
            <p>Önceki sonucun kaybolmayacak.</p>
          </ConfirmDialog>
        )}
      </>
    );
  }

  const remainingMs = getRemainingMs(session.timer, session.state, nowMs);
  const storageWarning = storageError
    ? <p className="storage-warning global-storage-warning" role="alert">{storageError}</p>
    : null;
  const terminal = ["COMPLETED", "EXPIRED"].includes(session.state) && session.result;
  if (terminal && reviewRoute) {
    return (
      <>
        {storageWarning}
        <ReviewScreen
          exam={sampleExam}
          session={session}
          onResults={() => routeTo(`/exam/${sampleExam.id}`)}
        />
      </>
    );
  }
  if (terminal) {
    return (
      <>
        {storageWarning}
        <ResultScreen
          exam={sampleExam}
          session={session}
          onReview={() => routeTo(`/exam/${sampleExam.id}/review`)}
          onHome={() => routeTo("/")}
        />
      </>
    );
  }
  if (session.state === "PAUSED") {
    return (
      <>
        {storageWarning}
        <PauseScreen
          exam={sampleExam}
          session={session}
          remainingMs={remainingMs}
          onResume={resumeExam}
          onRequestFinish={() => setFinishOpen(true)}
        />
        {finishOpen && (
          <FinishDialog
            session={session}
            remainingMs={remainingMs}
            busy={completionSaving}
            onCancel={() => setFinishOpen(false)}
            onConfirm={() => void finalizeCurrentSession("manual")}
          />
        )}
      </>
    );
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
        onRequestFinish={() => setFinishOpen(true)}
      />
      {finishOpen && (
        <FinishDialog
          session={session}
          remainingMs={remainingMs}
          busy={completionSaving}
          onCancel={() => setFinishOpen(false)}
          onConfirm={() => void finalizeCurrentSession("manual")}
        />
      )}
    </>
  );
}
