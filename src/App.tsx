import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { APP_NAME, APP_VERSION, AUTO_ADVANCE_AFTER_ANSWER, AUTO_ADVANCE_DELAY_MS } from "./config";
import { sampleExam } from "./exam";
import {
  prepareExamPackImport,
  safeExamPackFileName,
  serializeExamPack,
  type ExamPackImportError,
  type PreparedExamPack,
} from "./exam-pack-file";
import {
  defaultExamPackRepository,
  type ExamPackRepositoryContract,
} from "./exam-pack-repository";
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

interface ExamLibraryEntry {
  exam: ExamPack;
  installed: boolean;
}

function currentQuestionIndex(exam: ExamPack, session: ExamSession) {
  const index = exam.questions.findIndex((question) => question.id === session.currentQuestionId);
  return index >= 0 ? index : 0;
}

function routeTo(path: string) {
  window.history.pushState({}, "", `#${path}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

function currentRoutePath() {
  return window.location.hash.startsWith("#/") ? window.location.hash.slice(1) : window.location.pathname;
}

function examUrl(examId: string) {
  return `/exam/${encodeURIComponent(examId)}`;
}

function routeExam(path: string): { examId: string; review: boolean } | null {
  const match = path.match(/^\/exam\/([^/]+)(\/review)?$/);
  return match ? { examId: decodeURIComponent(match[1]), review: Boolean(match[2]) } : null;
}

function HomeScreen({
  entries,
  sessions,
  interrupted,
  storageError,
  importError,
  importSuccess,
  fileInputRef,
  onFileSelected,
  onStart,
  onViewResult,
  onRequestRetake,
  onExport,
  onImportSuccessOpen,
  onDismissImportSuccess,
}: {
  entries: ExamLibraryEntry[];
  sessions: Record<string, ExamSession | undefined>;
  interrupted: boolean;
  storageError: string | null;
  importError: ExamPackImportError | null;
  importSuccess: ExamPack | null;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileSelected: (file: File) => void;
  onStart: (exam: ExamPack) => void;
  onViewResult: (exam: ExamPack) => void;
  onRequestRetake: (exam: ExamPack) => void;
  onExport: (exam: ExamPack) => void;
  onImportSuccessOpen: (exam: ExamPack) => void;
  onDismissImportSuccess: () => void;
}) {
  return (
    <main className="home" aria-labelledby="exam-list-title">
      <section className="hero">
        <p className="eyebrow">Kişisel sınav alanı</p>
        <h1>{APP_NAME}</h1>
        <p className="hero-copy">Dikkat dağıtmayan, sakin bir çözüm deneyimi.</p>
      </section>

      <section aria-labelledby="exam-list-title">
        <div className="section-heading">
          <h2 id="exam-list-title">Sınavlar</h2>
          <span>{entries.length} sınav</span>
        </div>
        {interrupted && (
          <p className="notice" role="status">
            Bu sınav için devam edilecek aktif oturum bulunamadı. Yeni bir oturum başlatabilirsiniz.
          </p>
        )}
        {storageError && <p className="storage-warning" role="alert">{storageError}</p>}
        {importError && (
          <div className="import-feedback import-error" role="alert">
            <strong>{importError.message}</strong>
            {importError.details.length > 0 && (
              <ul>{importError.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
            )}
          </div>
        )}
        {importSuccess && (
          <div className="import-feedback import-success" role="status">
            <strong>Sınav eklendi</strong>
            <span>{importSuccess.title}</span>
            <span>{importSuccess.questionCount} soru · {importSuccess.durationMinutes} dakika</span>
            <div className="home-actions">
              <button className="primary-button" type="button" onClick={() => onImportSuccessOpen(importSuccess)}>
                Sınava Git
              </button>
              <button className="secondary-button" type="button" onClick={onDismissImportSuccess}>Tamam</button>
            </div>
          </div>
        )}
        <div className="exam-library">
          {entries.map(({ exam, installed }) => {
            const session = sessions[exam.id];
            const resumable = session && ["RUNNING", "PAUSED"].includes(session.state);
            const completedResult = session && ["COMPLETED", "EXPIRED"].includes(session.state)
              ? session.result
              : null;
            const questionIndex = session ? currentQuestionIndex(exam, session) : 0;
            return (
              <article className="exam-card" key={exam.id} data-exam-id={exam.id}>
                <div className="exam-card-topline">
                  <span className="practice-badge">{exam.kind === "official" ? "Resmî sınav" : "Deneme"}</span>
                  <span>{installed ? "Yüklü · " : ""}{exam.language}</span>
                </div>
                <h3>{exam.title}</h3>
                <dl className="exam-meta">
                  <div><dt>Soru</dt><dd>{exam.questionCount}</dd></div>
                  <div><dt>Süre</dt><dd>{exam.durationMinutes} dakika</dd></div>
                </dl>
                {resumable && (
                  <div className="active-session-summary" aria-label="Aktif sınav oturumu">
                    <strong>{session.state === "PAUSED" ? "Duraklatıldı" : "Sınav devam ediyor"}</strong>
                    <span>Soru {questionIndex + 1} / {exam.questionCount}</span>
                  </div>
                )}
                {completedResult && !resumable && (
                  <div className="active-session-summary" aria-label="Son sınav sonucu">
                    <strong>Son sonuç</strong>
                    <span>{completedResult.correct} doğru · {completedResult.incorrect} yanlış · {completedResult.blank} boş</span>
                  </div>
                )}
                {completedResult && !resumable ? (
                  <div className="home-actions">
                    <button className="primary-button" type="button" onClick={() => onViewResult(exam)}>Sonucu Gör</button>
                    <button className="secondary-button" type="button" onClick={() => onRequestRetake(exam)}>Yeniden Çöz</button>
                  </div>
                ) : (
                  <button className="primary-button" type="button" onClick={() => onStart(exam)}>
                    {resumable ? "Devam Et" : "Sınava Başla"}
                  </button>
                )}
                {installed && (
                  <button className="export-button" type="button" onClick={() => onExport(exam)}>
                    Sınav Paketini Dışa Aktar
                  </button>
                )}
              </article>
            );
          })}
        </div>
        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept=".ydspack,.json,application/json,application/octet-stream"
          data-testid="exam-pack-input"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) onFileSelected(file);
            event.currentTarget.value = "";
          }}
        />
        <button className="import-button" type="button" onClick={() => fileInputRef.current?.click()}>
          + Sınav Paketi Ekle
        </button>
      </section>
      <footer className="app-footer">
        <span>Sınavlar ve cevaplar cihazınızda saklanır.</span>
        <span>{APP_NAME} v{APP_VERSION}</span>
      </footer>
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

function FinishDialog({ exam, session, remainingMs, busy, onCancel, onConfirm }: {
  exam: ExamPack;
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
        <div><dt>Boş</dt><dd>{exam.questionCount - answered}</dd></div>
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
      <p className="eyebrow">{APP_NAME}</p>
      <h1>{APP_NAME} yükleniyor…</h1>
    </main>
  );
}

export function App({
  clock = systemClock,
  repository = defaultSessionRepository,
  examPackRepository = defaultExamPackRepository,
}: {
  clock?: Clock;
  repository?: SessionRepositoryContract;
  examPackRepository?: ExamPackRepositoryContract;
}) {
  const [path, setPath] = useState(currentRoutePath);
  const [entries, setEntries] = useState<ExamLibraryEntry[]>([
    { exam: sampleExam, installed: false },
  ]);
  const [sessions, setSessions] = useState<Record<string, ExamSession | undefined>>({});
  const [nowMs, setNowMs] = useState(() => clock.now());
  const [hydrationState, setHydrationState] = useState<HydrationState>("loading");
  const [storageError, setStorageError] = useState<string | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [retakeExam, setRetakeExam] = useState<ExamPack | null>(null);
  const [completionSaving, setCompletionSaving] = useState(false);
  const [importCandidate, setImportCandidate] = useState<PreparedExamPack | null>(null);
  const [importError, setImportError] = useState<ExamPackImportError | null>(null);
  const [importSuccess, setImportSuccess] = useState<ExamPack | null>(null);
  const sessionsRef = useRef<Record<string, ExamSession | undefined>>({});
  const autoAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoAdvanceToken = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const routeInfo = routeExam(path);
  const exam = routeInfo
    ? entries.find((entry) => entry.exam.id === routeInfo.examId)?.exam
    : undefined;
  const session = exam ? sessions[exam.id] : undefined;

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
    sessionsRef.current = { ...sessionsRef.current, [nextSession.examId]: nextSession };
    setSessions((current) => ({ ...current, [nextSession.examId]: nextSession }));
    return persistSession(nextSession, updatedAt);
  }, [clock, persistSession]);

  const finalizeCurrentSession = useCallback(async (completionReason: CompletionReason) => {
    if (!exam) return;
    const current = sessionsRef.current[exam.id];
    if (!current) return;
    if (["COMPLETED", "EXPIRED"].includes(current.state) && current.result) {
      setSessions((sessionsState) => ({ ...sessionsState, [exam.id]: current }));
      return;
    }

    clearAutoAdvance();
    const completedAt = clock.now();
    const terminal = finalizeExamSession(exam, current, completionReason, completedAt);
    sessionsRef.current = { ...sessionsRef.current, [exam.id]: terminal };
    setCompletionSaving(true);
    try {
      await repository.saveSession(terminal, completedAt);
      setStorageError(null);
      setSessions((currentSessions) => ({ ...currentSessions, [exam.id]: terminal }));
      setFinishOpen(false);
    } catch (error) {
      console.error("[session-storage] completion save failed", error);
      setStorageError("Sınav sonucu kaydedilemedi. Lütfen tekrar dene.");
      if (completionReason === "manual") {
        sessionsRef.current = { ...sessionsRef.current, [exam.id]: current };
      } else {
        setSessions((currentSessions) => ({ ...currentSessions, [exam.id]: terminal }));
      }
    } finally {
      setCompletionSaving(false);
    }
  }, [clearAutoAdvance, clock, exam, repository]);

  useEffect(() => {
    const handleRouteChange = () => setPath(currentRoutePath());
    window.addEventListener("popstate", handleRouteChange);
    window.addEventListener("hashchange", handleRouteChange);
    return () => {
      window.removeEventListener("popstate", handleRouteChange);
      window.removeEventListener("hashchange", handleRouteChange);
    };
  }, []);

  useEffect(() => clearAutoAdvance, [clearAutoAdvance]);

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      try {
        const installed = await examPackRepository.listInstalled();
        const hydratedEntries: ExamLibraryEntry[] = [
          { exam: sampleExam, installed: false },
          ...installed
            .filter((record) => record.id !== sampleExam.id)
            .map((record) => ({ exam: record.examPack, installed: true })),
        ];
        if (cancelled) return;
        const hydratedSessions: Record<string, ExamSession | undefined> = {};
        for (const { exam: hydratedExam } of hydratedEntries) {
          const active = await repository.findActiveSessionForExam(hydratedExam.id);
          const restored = active
            ?? await repository.findLatestCompletedAttemptForExam(hydratedExam.id);
          if (!restored) continue;
          if (!hydratedExam.questions.some(({ id }) => id === restored.currentQuestionId)) {
            console.error(`[session-storage] ignored session ${restored.id} with unknown currentQuestionId`);
            continue;
          }

          const currentNow = clock.now();
          const snapshot = synchronizeTimer(restored.timer, restored.state, currentNow);
          const timerReconciled = withTimerSnapshot(restored, snapshot, currentNow);
          const reconciled = timerReconciled.state === "EXPIRED" && !timerReconciled.result
            ? finalizeExamSession(hydratedExam, timerReconciled, "expired", currentNow)
            : timerReconciled;
          if (reconciled.state !== restored.state || reconciled.result !== restored.result) {
            await persistSession(reconciled, currentNow);
          }
          hydratedSessions[hydratedExam.id] = reconciled;
          setNowMs(currentNow);
        }
        if (!cancelled) {
          sessionsRef.current = hydratedSessions;
          setEntries(hydratedEntries);
          setSessions(hydratedSessions);
          setHydrationState("ready");
        }
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
  }, [clock, examPackRepository, persistSession, repository]);

  useEffect(() => {
    if (session?.state !== "RUNNING") return;

    const refresh = () => {
      const currentNow = clock.now();
      setNowMs(currentNow);
      if (!exam) return;
      const current = sessionsRef.current[exam.id];
      if (!current || current.state !== "RUNNING") return;
      const snapshot = synchronizeTimer(current.timer, current.state, currentNow);
      if (snapshot.status === "EXPIRED") {
        sessionsRef.current = {
          ...sessionsRef.current,
          [exam.id]: withTimerSnapshot(current, snapshot, currentNow),
        };
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
  }, [clock, exam, finalizeCurrentSession, session?.state]);

  const expireIfNeeded = () => {
    if (!exam) return false;
    const current = sessionsRef.current[exam.id];
    if (!current || current.state !== "RUNNING") return false;
    const currentNow = clock.now();
    const snapshot = synchronizeTimer(current.timer, current.state, currentNow);
    if (snapshot.status !== "EXPIRED") return false;
    setNowMs(currentNow);
    sessionsRef.current = {
      ...sessionsRef.current,
      [exam.id]: withTimerSnapshot(current, snapshot, currentNow),
    };
    void finalizeCurrentSession("expired");
    return true;
  };

  const createNewSession = (targetExam: ExamPack) => {
    clearAutoAdvance();
    const currentNow = clock.now();
    const timerSnapshot = startTimer(targetExam.durationMinutes * 60_000, currentNow);
    const nextSession: ExamSession = {
      schemaVersion: 1,
      id: typeof crypto.randomUUID === "function"
        ? `session-${crypto.randomUUID()}`
        : `session-${currentNow}-${Math.random().toString(36).slice(2)}`,
      examId: targetExam.id,
      examPackSchemaVersion: 1,
      currentQuestionId: targetExam.questions[0].id,
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
    routeTo(examUrl(targetExam.id));
  };

  const startOrContinueExam = (targetExam: ExamPack) => {
    const existing = sessionsRef.current[targetExam.id];
    if (existing && ["RUNNING", "PAUSED"].includes(existing.state)) {
      routeTo(examUrl(targetExam.id));
      return;
    }
    createNewSession(targetExam);
  };

  const startRetake = () => {
    if (!retakeExam) return;
    const target = retakeExam;
    setRetakeExam(null);
    createNewSession(target);
  };

  const navigateToQuestion = (index: number) => {
    clearAutoAdvance();
    if (!exam) return;
    const current = sessionsRef.current[exam.id];
    if (!current || current.state !== "RUNNING" || expireIfNeeded()) return;
    const question = exam.questions[index];
    if (!question) return;
    void commitSession(navigateSession(current, question.id));
  };

  const answerCurrentQuestion = (answer: ChoiceKey) => {
    if (!exam) return;
    const current = sessionsRef.current[exam.id];
    if (!current || current.state !== "RUNNING" || expireIfNeeded()) return;
    clearAutoAdvance();
    const questionIndex = currentQuestionIndex(exam, current);
    const question = exam.questions[questionIndex];
    const answeredSession = answerSession(current, question.id, answer);
    const saveAnswer = commitSession(answeredSession);

    if (AUTO_ADVANCE_AFTER_ANSWER && questionIndex < exam.questions.length - 1) {
      const expectedQuestionId = question.id;
      const token = autoAdvanceToken.current;
      void saveAnswer.then(() => {
        if (token !== autoAdvanceToken.current) return;
        autoAdvanceTimer.current = setTimeout(() => {
          const latest = sessionsRef.current[exam.id];
          const currentNow = clock.now();
          setNowMs(currentNow);
          if (!latest || latest.state !== "RUNNING" || latest.currentQuestionId !== expectedQuestionId) {
            return;
          }
          const snapshot = synchronizeTimer(latest.timer, latest.state, currentNow);
          if (snapshot.status === "EXPIRED") {
            sessionsRef.current = {
              ...sessionsRef.current,
              [exam.id]: withTimerSnapshot(latest, snapshot, currentNow),
            };
            void finalizeCurrentSession("expired");
            return;
          }
          const nextQuestion = exam.questions[questionIndex + 1];
          void commitSession(navigateSession(latest, nextQuestion.id), currentNow);
          autoAdvanceTimer.current = null;
        }, AUTO_ADVANCE_DELAY_MS);
      });
    }
  };

  const toggleCurrentFlag = () => {
    if (!exam) return;
    const current = sessionsRef.current[exam.id];
    if (!current || current.state !== "RUNNING" || expireIfNeeded()) return;
    const questionId = current.currentQuestionId;
    void commitSession(toggleFlagSession(current, questionId));
  };

  const pauseExam = () => {
    if (!exam) return;
    const current = sessionsRef.current[exam.id];
    if (!current || current.state !== "RUNNING") return;
    clearAutoAdvance();
    const currentNow = clock.now();
    const snapshot = pauseTimer(current.timer, current.state, currentNow);
    setNowMs(currentNow);
    if (snapshot.status === "EXPIRED") {
      sessionsRef.current = {
        ...sessionsRef.current,
        [exam.id]: withTimerSnapshot(current, snapshot, currentNow),
      };
      void finalizeCurrentSession("expired");
      return;
    }
    void commitSession(withTimerSnapshot(current, snapshot, currentNow), currentNow);
  };

  const resumeExam = () => {
    if (!exam) return;
    const current = sessionsRef.current[exam.id];
    if (!current || current.state !== "PAUSED") return;
    const currentNow = clock.now();
    const snapshot = resumeTimer(current.timer, current.state, currentNow);
    setNowMs(currentNow);
    void commitSession(withTimerSnapshot(current, snapshot, currentNow), currentNow);
  };

  const handleFileSelected = async (file: File) => {
    setImportError(null);
    setImportSuccess(null);
    const result = await prepareExamPackImport(file, examPackRepository, [sampleExam]);
    if (result.ok) setImportCandidate(result.candidate);
    else setImportError(result.error);
  };

  const confirmImport = async () => {
    if (!importCandidate) return;
    const result = await examPackRepository.install(
      importCandidate.examPack,
      importCandidate.fingerprint,
      clock.now(),
    );
    if (result.status === "installed") {
      setEntries((current) => [
        ...current,
        { exam: result.record.examPack, installed: true },
      ]);
      setImportSuccess(result.record.examPack);
      setImportCandidate(null);
      return;
    }
    setImportCandidate(null);
    setImportError({
      code: result.status,
      message: result.status === "duplicate"
        ? "Bu sınav zaten yüklü."
        : "Bu kimliğe sahip farklı bir sınav paketi zaten yüklü.",
      details: result.status === "conflict"
        ? ["Güvenlik nedeniyle mevcut sınav değiştirilmedi."]
        : [],
    });
  };

  const exportExam = (targetExam: ExamPack) => {
    const blob = new Blob([serializeExamPack(targetExam)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = safeExamPackFileName(targetExam);
    link.click();
    URL.revokeObjectURL(url);
  };

  if (hydrationState === "loading") return <LoadingScreen />;

  if (!routeInfo || !exam || !session) {
    return (
      <>
        <HomeScreen
          entries={entries}
          sessions={sessions}
          onStart={startOrContinueExam}
          onViewResult={(targetExam) => routeTo(examUrl(targetExam.id))}
          onRequestRetake={setRetakeExam}
          onExport={exportExam}
          onImportSuccessOpen={startOrContinueExam}
          onDismissImportSuccess={() => setImportSuccess(null)}
          onFileSelected={(file) => void handleFileSelected(file)}
          fileInputRef={fileInputRef}
          interrupted={Boolean(routeInfo) && (!exam || !session)}
          storageError={storageError}
          importError={importError}
          importSuccess={importSuccess}
        />
        {retakeExam && (
          <ConfirmDialog
            title="Yeni bir sınav başlatılsın mı?"
            confirmLabel="Yeni Sınav"
            onCancel={() => setRetakeExam(null)}
            onConfirm={startRetake}
          >
            <p>Önceki sonucun kaybolmayacak.</p>
          </ConfirmDialog>
        )}
        {importCandidate && (
          <ConfirmDialog
            title={importCandidate.examPack.title}
            confirmLabel="Sınavı Ekle"
            onCancel={() => setImportCandidate(null)}
            onConfirm={() => void confirmImport()}
          >
            <dl className="finish-summary">
              <div><dt>Soru</dt><dd>{importCandidate.examPack.questionCount}</dd></div>
              <div><dt>Süre</dt><dd>{importCandidate.examPack.durationMinutes} dakika</dd></div>
              <div><dt>Dil</dt><dd>{importCandidate.examPack.language}</dd></div>
              <div><dt>Tür</dt><dd>{importCandidate.examPack.kind === "official" ? "Resmî" : "Deneme"}</dd></div>
            </dl>
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
  if (terminal && routeInfo.review) {
    return (
      <>
        {storageWarning}
        <ReviewScreen
          exam={exam}
          session={session}
          onResults={() => routeTo(examUrl(exam.id))}
        />
      </>
    );
  }
  if (terminal) {
    return (
      <>
        {storageWarning}
        <ResultScreen
          exam={exam}
          session={session}
          onReview={() => routeTo(`${examUrl(exam.id)}/review`)}
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
          exam={exam}
          session={session}
          remainingMs={remainingMs}
          onResume={resumeExam}
          onRequestFinish={() => setFinishOpen(true)}
        />
        {finishOpen && (
          <FinishDialog
            exam={exam}
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
        exam={exam}
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
          exam={exam}
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
